// functions/debugMonitorData.js
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

  let data, pwHash;
  try {
    [data, pwHash] = await redisClient.mget(
      `monitor:${token}`,
      `tenant:${token}:pwHash`
    );
  } catch (err) {
    console.error('Redis mget error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }

  let stored;
  try {
    stored = data ? (typeof data === 'string' ? JSON.parse(data) : data) : null;
  } catch {
    return { statusCode: 500, body: JSON.stringify({ error: 'Dados inválidos no Redis' }) };
  }

  const empresa   = stored ? stored.empresa : null;
  const schedule  = stored ? stored.schedule : null;
  const tokenRedis = stored ? token : null;
  const tokenMatch = !!stored;

  const valid     = pwHash ? await bcrypt.compare(senha, pwHash) : false;
  const inputHash = pwHash ? bcrypt.hashSync(senha, pwHash) : null;

  return {
    statusCode: 200,
    body: JSON.stringify({
      empresa,
      schedule,
      pwHash: pwHash || null,
      inputHash,
      valid,
      tokenIn: token,
      tokenRedis,
      tokenMatch
    })
  };
};
