// functions/saveMonitorConfig.js
const { Redis } = require('@upstash/redis');
const bcrypt = require('bcryptjs');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});

function sanitizeEmpresa(name) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, '');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método não permitido' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  const { token, empresa, senha, trialDays, schedule } = body;
  if (!token || !empresa || !senha) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Dados incompletos' }) };
  }

  const empresaKey = sanitizeEmpresa(empresa);
  if (!empresaKey) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Nome de empresa inválido' }) };
  }

  const ttl = (trialDays ?? 7) * 24 * 60 * 60;

  try {
    const pwHash = await bcrypt.hash(senha, 10);
    await redis.set(
      `monitor:${token}`,
      JSON.stringify({ empresa, schedule }),
      { ex: ttl }
    );
    await redis.set(
      `monitorByEmpresa:${empresaKey}`,
      token,
      { ex: ttl }
    );
    await redis.set(
      `tenant:${token}:pwHash`,
      pwHash,
      { ex: ttl }
    );
    if (schedule) {
      await redis.set(
        `tenant:${token}:schedule`,
        JSON.stringify(schedule),
        { ex: ttl }
      );
    }
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, expiresIn: ttl })
    };
  } catch (err) {
    console.error('Redis error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
