import { Redis } from '@upstash/redis';
import errorHandler from './utils/errorHandler.js';
import { error, json } from './utils/response.js';

export async function handler(event) {
  try {
    const url = new URL(event.rawUrl);
    const token = url.searchParams.get('t');
    if (!token) {
      return error(400, 'Token ausente');
    }
    const redis = Redis.fromEnv();
    const clones = await redis.smembers(`tenant:${token}:clones`);
    return json(200, { clones });
  } catch (error) {
    return errorHandler(error);
  }
}
