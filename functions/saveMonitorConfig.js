import { Redis } from '@upstash/redis';
import errorHandler from './utils/errorHandler.js';
import bcrypt from 'bcryptjs';
import { error, json } from './utils/response.js';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

function sanitizeEmpresa(name) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, '');
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return error(405, 'Método não permitido');
    }

    let body;
    try {
      body = JSON.parse(event.body);
    } catch {
      return error(400, 'JSON inválido');
    }

    const { token, empresa, senha, trialDays, schedule, preferentialDesk } = body;
    if (!token || !empresa || !senha) {
      return error(400, 'Dados incompletos');
    }

    const empresaKey = sanitizeEmpresa(empresa);
    if (!empresaKey) {
      return error(400, 'Nome de empresa inválido');
    }

    const ttl = (trialDays ?? 7) * 24 * 60 * 60;

    const pwHash = await bcrypt.hash(senha, 10);
    await redis.set(
      `monitor:${token}`,
      JSON.stringify({ empresa, schedule, preferentialDesk: preferentialDesk !== false }),
      { ex: ttl }
    );
    await redis.set(`monitorByEmpresa:${empresaKey}`, token, { ex: ttl });
    await redis.set(`tenant:${token}:pwHash`, pwHash, { ex: ttl });
    if (schedule) {
      await redis.set(
        `tenant:${token}:schedule`,
        JSON.stringify(schedule),
        { ex: ttl }
      );
    }
    return json(200, { ok: true, expiresIn: ttl });
  } catch (error) {
    return errorHandler(error);
  }
}
