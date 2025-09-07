import { Redis } from '@upstash/redis';

export async function handler(event) {
  try {
    const { token, cloneId } = JSON.parse(event.body || '{}');
    if (!token || !cloneId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing fields' }) };
    }
    const redis = Redis.fromEnv();
    await redis.sadd(`tenant:${token}:clones`, cloneId);
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.error('registerClone error', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error' }) };
  }
}
