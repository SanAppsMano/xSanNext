// functions/validatePassword.js
import { Redis } from '@upstash/redis';
import bcrypt from 'bcryptjs';
import { error, json } from './utils/response.js';

export async function handler(event) {
  try {
    const url       = new URL(event.rawUrl);
    const tenantId  = url.searchParams.get('t');
    const { password } = JSON.parse(event.body || '{}');
    if (!tenantId || !password) {
      return error(400, 'Invalid request');
    }

    const redis = Redis.fromEnv();
    const [storedHash, monitor] = await redis.mget(
      `tenant:${tenantId}:pwHash`,
      `monitor:${tenantId}`
    );
    if (!storedHash && !monitor) {
      return error(404, 'Invalid link');
    }
    if (!storedHash) {
      return json(404, { valid: false });
    }

    const valid = await bcrypt.compare(password, storedHash);
    // Optionally fetch label
    const label = valid
      ? (await redis.get(`tenant:${tenantId}:label`)) || ''
      : '';

    return json(200, { valid, label });
  } catch (err) {
    console.error('validatePassword error', err);
    return error(500, 'Server error');
  }
}
