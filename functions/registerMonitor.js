// functions/registerMonitor.js
import { Redis } from '@upstash/redis';
import bcrypt from 'bcryptjs';
import { error, json } from './utils/response.js';

export async function handler(event) {
  try {
    const { tenantId, label, password } = JSON.parse(event.body || '{}');
    if (!tenantId || !label || !password) {
      return error(400, 'Missing fields');
    }

    // Cria hash seguro da senha
    const saltRounds = 10;
    const hash = await bcrypt.hash(password, saltRounds);

    const redis = Redis.fromEnv();
    // Armazena as configurações do tenant no Redis
    await redis.set(`tenant:${tenantId}:label`, label);
    await redis.set(`tenant:${tenantId}:pwHash`, hash);

    // Inicializa todos os contadores do tenant
    await redis.set(`tenant:${tenantId}:ticketCounter`, 0);
    await redis.set(`tenant:${tenantId}:callCounter`,  0);
    await redis.set(`tenant:${tenantId}:currentCall`,  0);
    await redis.set(`tenant:${tenantId}:currentCallTs`, Date.now());
    await redis.set(`tenant:${tenantId}:logoutVersion`, 0);
    await redis.del(`tenant:${tenantId}:clones`);

    return json(200, { success: true, tenantId });
  } catch (err) {
    console.error('registerMonitor error', err);
    return error(500, 'Server error');
  }
}
