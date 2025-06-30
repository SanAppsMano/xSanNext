// functions/extendSubscription.js
const { Redis } = require('@upstash/redis');

const redisExt = new Redis({
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

  const { token, extraDays } = body;
  if (!token || !extraDays) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Dados incompletos' }) };
  }

  let ttlNow;
  try {
    ttlNow = await redisExt.ttl(`monitor:${token}`);
  } catch (err) {
    console.error('Redis TTL error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }

  if (ttlNow < 0) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Token expirado' }) };
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
      await redisExt.expire(`monitorByEmpresa:${empresa.toLowerCase()}`, novoTTL);
    }
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, expiresIn: novoTTL })
    };
  } catch (err) {
    console.error('Redis expire error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
