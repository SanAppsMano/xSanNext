// functions/deleteMonitorConfig.js

const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Método não permitido' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'JSON inválido' })
    };
  }

  const { token } = body;
  if (!token) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Token ausente' })
    };
  }

  try {
    // Remove também índice possivelmente cadastrado (tenantByEmail), se existir
    await redis.del(`monitor:${token}`);
    await redis.del(`tenantByEmail:${token}`);
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true })
    };
  } catch (err) {
    console.error('Erro ao deletar no Redis:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
