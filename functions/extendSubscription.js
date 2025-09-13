import { Redis } from '@upstash/redis';
import { error, json } from './utils/response.js';

const redisExt = new Redis({
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
  if (event.httpMethod !== 'POST') {
    return error(405, 'Método não permitido');
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return error(400, 'JSON inválido');
  }

  const { token, extraDays } = body;
  if (!token || !extraDays) {
    return error(400, 'Dados incompletos');
  }

  let ttlNow;
  try {
    ttlNow = await redisExt.ttl(`monitor:${token}`);
  } catch (err) {
    console.error('Redis TTL error:', err);
    return error(500, err.message);
  }

  if (ttlNow < 0) {
    return error(404, 'Token expirado');
  }

  const novoTTL = ttlNow + extraDays * 24 * 60 * 60;
  try {
    const data = await redisExt.get(`monitor:${token}`);
    let empresa;
    if (data) {
      try { empresa = JSON.parse(data).empresa; } catch {}
    }
    await redisExt.expire(`monitor:${token}`, novoTTL);
    if (empresa) {
      const empresaKey = sanitizeEmpresa(empresa);
      if (empresaKey) {
        await redisExt.expire(`monitorByEmpresa:${empresaKey}`, novoTTL);
      }
    }
    return json(200, { ok: true, expiresIn: novoTTL });
  } catch (err) {
    console.error('Redis expire error:', err);
    return error(500, err.message);
  }
}
