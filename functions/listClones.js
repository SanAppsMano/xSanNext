import { Redis } from '@upstash/redis';
import { error, json } from './utils/response.js';

export async function handler(event) {
  try {
    const url = new URL(event.rawUrl);
    const token = url.searchParams.get('t');
    if (!token) {
      return error(400, 'Missing token');
    }
    const redis = Redis.fromEnv();
    const clones = await redis.smembers(`tenant:${token}:clones`);
    return json(200, { clones });
  } catch (e) {
    console.error('listClones error', e);
    return error(500, 'Server error');
  }
}
