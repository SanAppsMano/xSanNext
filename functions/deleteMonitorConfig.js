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
    const data = await redis.get(`monitor:${token}`);
    let empresa;
    if (data) {
      try { empresa = JSON.parse(data).empresa; } catch {}
    }
    // Remove também índice possivelmente cadastrado (tenantByEmail), se existir
    const keys = [`monitor:${token}`, `tenantByEmail:${token}`];
    if (empresa) {
      keys.push(`monitorByEmpresa:${empresa.toLowerCase()}`);
    }
    await redis.del(...keys);
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
