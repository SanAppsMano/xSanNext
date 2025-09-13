import { Redis } from '@upstash/redis';
import errorHandler from './utils/errorHandler.js';
import { error, json } from './utils/response.js';

export async function handler(event) {
  try {
    const { token, cloneId } = JSON.parse(event.body || '{}');
    if (!token || !cloneId) {
      return error(400, 'Campos obrigatórios ausentes');
    }
    const redis = Redis.fromEnv();
    await redis.srem(`tenant:${token}:clones`, cloneId);
    return json(200, { ok: true });
  } catch (error) {
    return errorHandler(error);
  }
}
