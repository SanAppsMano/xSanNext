// functions/getSchedule.js
const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});

exports.handler = async (event) => {
  const token = event.queryStringParameters && event.queryStringParameters.t;
  if (!token) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing token' }) };
  }
  try {
    const [schedRaw, monitorRaw, pwHash] = await redis.mget(
      `tenant:${token}:schedule`,
      `monitor:${token}`,
      `tenant:${token}:pwHash`
    );
    if (!pwHash && !monitorRaw) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Invalid link' }) };
    }
    if (schedRaw) {
      let parsed;
      try {
        parsed = typeof schedRaw === 'string' ? JSON.parse(schedRaw) : schedRaw;
      } catch {
        return { statusCode: 500, body: JSON.stringify({ error: 'Dados inválidos' }) };
      }
      return { statusCode: 200, body: JSON.stringify({ schedule: parsed }) };
    }
    if (monitorRaw) {
      let stored;
      try {
        stored = JSON.parse(monitorRaw);
      } catch {
        return { statusCode: 500, body: JSON.stringify({ error: 'Dados inválidos' }) };
      }
      return {
        statusCode: 200,
        body: JSON.stringify({ schedule: stored.schedule || null })
      };
    }
    return { statusCode: 404, body: JSON.stringify({ error: 'Configuração não encontrada' }) };
  } catch (err) {
    console.error('getSchedule error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
