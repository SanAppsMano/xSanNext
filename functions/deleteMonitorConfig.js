import { Redis } from '@upstash/redis';
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
  if (event.httpMethod !== 'POST') {
    return error(405, 'Método não permitido');
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return error(400, 'JSON inválido');
  }

  const { token } = body;
  if (!token) {
    return error(400, 'Token ausente');
  }

  try {
    const data = await redis.get(`monitor:${token}`);
    let empresa;
    if (data) {
      try { empresa = JSON.parse(data).empresa; } catch {}
    }
    const keys = [`monitor:${token}`, `tenantByEmail:${token}`];
    if (empresa) {
      const empresaKey = sanitizeEmpresa(empresa);
      if (empresaKey) {
        keys.push(`monitorByEmpresa:${empresaKey}`);
      }
    }
    await redis.del(...keys);

    const prefix = `tenant:${token}:`;
    let cursor = 0;
    do {
      const [next, found] = await redis.scan(cursor, {
        match: `${prefix}*`,
        count: 100,
      });
      if (found.length > 0) {
        await redis.del(...found);
      }
      cursor = Number(next);
    } while (cursor !== 0);

    return json(200, { ok: true });
  } catch (err) {
    console.error('Erro ao deletar no Redis:', err);
    return error(500, err.message);
  }
}
