// functions/saveMonitorConfig.js
const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});

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

  const { token, empresa, senha, trialDays } = body;
  if (!token || !empresa || !senha) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Dados incompletos' }) };
  }

  const ttl = (trialDays ?? 7) * 24 * 60 * 60;

  try {
    await redis.set(
      `monitor:${token}`,
      JSON.stringify({ empresa, senha }),
      { ex: ttl }
    );
    await redis.set(
      `monitorByEmpresa:${empresa.toLowerCase()}`,
      token,
      { ex: ttl }
    );
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
