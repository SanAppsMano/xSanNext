import { Redis } from '@upstash/redis';
import { error, json } from './utils/response.js';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export async function handler(event) {
  const token = event.queryStringParameters && event.queryStringParameters.t;
  if (!token) {
    return error(400, 'Missing token');
  }
  try {
    const [schedRaw, monitorRaw, pwHash] = await redis.mget(
      `tenant:${token}:schedule`,
      `monitor:${token}`,
      `tenant:${token}:pwHash`
    );
    if (!pwHash && !monitorRaw) {
      return error(404, 'Invalid link');
    }
    if (schedRaw) {
      let parsed;
      try {
        parsed = typeof schedRaw === 'string' ? JSON.parse(schedRaw) : schedRaw;
      } catch {
        return error(500, 'Dados inválidos');
      }
      return json(200, { schedule: parsed });
    }
    if (monitorRaw) {
      let stored;
      try {
        stored = JSON.parse(monitorRaw);
      } catch {
        return error(500, 'Dados inválidos');
      }
      return json(200, { schedule: stored.schedule || null });
    }
    return error(404, 'Configuração não encontrada');
  } catch (err) {
    console.error('getSchedule error:', err);
    return error(500, err.message);
  }
}
