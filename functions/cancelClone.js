import { Redis } from '@upstash/redis';
import { error, json } from './utils/response.js';

export async function handler(event) {
  try {
    const { token, cloneId } = JSON.parse(event.body || '{}');
    if (!token || !cloneId) {
      return error(400, 'Missing fields');
    }
    const redis = Redis.fromEnv();
    await redis.srem(`tenant:${token}:clones`, cloneId);
    return json(200, { ok: true });
  } catch (e) {
    console.error('cancelClone error', e);
    return error(500, 'Server error');
  }
}
