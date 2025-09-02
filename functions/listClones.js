import { Redis } from '@upstash/redis';

export async function handler(event) {
  try {
    const url = new URL(event.rawUrl);
    const token = url.searchParams.get('t');
    if (!token) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing token' }) };
    }
    const redis = Redis.fromEnv();
    const clones = await redis.smembers(`tenant:${token}:clones`);
    return { statusCode: 200, body: JSON.stringify({ clones }) };
  } catch (e) {
    console.error('listClones error', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error' }) };
  }
}
