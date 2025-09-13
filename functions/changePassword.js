import { Redis } from '@upstash/redis';
import bcrypt from 'bcryptjs';
import { error, json } from './utils/response.js';

export async function handler(event) {
  try {
    const { token, senhaAtual, novaSenha } = JSON.parse(event.body || '{}');
    if (!token || !senhaAtual || !novaSenha) {
      return error(400, 'Missing fields');
    }
    const redis = Redis.fromEnv();
    const pwHash = await redis.get(`tenant:${token}:pwHash`);
    if (!pwHash) {
      return error(404, 'Invalid token');
    }
    const valid = await bcrypt.compare(senhaAtual, pwHash);
    if (!valid) {
      return error(403, 'Senha atual incorreta');
    }
    const newHash = await bcrypt.hash(novaSenha, 10);
    await redis.set(`tenant:${token}:pwHash`, newHash);
    await redis.incr(`tenant:${token}:logoutVersion`);
    return json(200, { ok: true });
  } catch (e) {
    console.error('changePassword error', e);
    return error(500, 'Server error');
  }
}
