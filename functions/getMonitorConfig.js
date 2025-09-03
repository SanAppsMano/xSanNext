// functions/getMonitorConfig.js
const { Redis } = require('@upstash/redis');
const bcrypt = require('bcryptjs');

const redisClient = new Redis({
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

  const { token, senha } = body;
  if (!token || !senha) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Token ou senha ausente' }) };
  }

  let data, hash;
  try {
    [data, hash] = await redisClient.mget(
      `monitor:${token}`,
      `tenant:${token}:pwHash`
    );
  } catch (err) {
    console.error('Redis fetch error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }

  if (!data) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Configuração não encontrada' }) };
  }
  if (!hash) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Senha não configurada' }) };
  }

  let stored;
  try {
    stored = data ? (typeof data === 'string' ? JSON.parse(data) : data) : null;
  } catch {
    return { statusCode: 500, body: JSON.stringify({ error: 'Dados inválidos no Redis' }) };
  }

  if (!stored) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Configuração não encontrada' }) };
  }

  const valid = await bcrypt.compare(senha, hash);
  if (!valid) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Senha inválida' }) };
  }

  let schedule = stored.schedule;
  if (!schedule) {
    try {
      const schedRaw = await redisClient.get(`tenant:${token}:schedule`);
      if (schedRaw) {
        schedule = typeof schedRaw === 'string' ? JSON.parse(schedRaw) : schedRaw;
      }
    } catch (err) {
      console.error('schedule fetch error:', err);
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ empresa: stored.empresa, schedule })
  };
};
