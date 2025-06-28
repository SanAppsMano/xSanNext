// functions/validatePassword.js
import { Redis } from '@upstash/redis';
import bcrypt from 'bcryptjs';

export async function handler(event) {
  try {
    const url       = new URL(event.rawUrl);
    const tenantId  = url.searchParams.get('t');
    const { password } = JSON.parse(event.body || '{}');
    if (!tenantId || !password) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request' }) };
    }

    const redis = Redis.fromEnv();
    const hashKey = `tenant:${tenantId}:pwHash`;
    const storedHash = await redis.get(hashKey);
    if (!storedHash) {
      return { statusCode: 404, body: JSON.stringify({ valid: false }) };
    }

    const valid = await bcrypt.compare(password, storedHash);
    // Optionally fetch label
    const label = valid
      ? (await redis.get(`tenant:${tenantId}:label`)) || ''
      : '';

    return {
      statusCode: 200,
      body: JSON.stringify({ valid, label })
    };
  } catch (err) {
    console.error('validatePassword error', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error' }) };
  }
}
