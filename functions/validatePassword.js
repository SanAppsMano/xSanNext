// functions/validatePassword.js
import { Redis } from '@upstash/redis';
import errorHandler from './utils/errorHandler.js';
import bcrypt from 'bcryptjs';
import { error, json } from './utils/response.js';

export async function handler(event) {
  try {
    const url       = new URL(event.rawUrl);
    const tenantId  = url.searchParams.get('t');
    const { password } = JSON.parse(event.body || '{}');
    if (!tenantId || !password) {
      return error(400, 'Solicitação inválida');
    }

    const redis = Redis.fromEnv();
    const [storedHash, monitor] = await redis.mget(
      `tenant:${tenantId}:pwHash`,
      `monitor:${tenantId}`
    );
    if (!storedHash && !monitor) {
      return error(404, 'Link inválido');
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
  } catch (error) {
    return errorHandler(error);
  }
}
