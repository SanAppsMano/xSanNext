import { Redis } from '@upstash/redis';
import bcrypt from 'bcryptjs';

export async function handler(event) {
  try {
    const { token, senhaAtual, novaSenha } = JSON.parse(event.body || '{}');
    if (!token || !senhaAtual || !novaSenha) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing fields' }) };
    }
    const redis = Redis.fromEnv();
    const pwHash = await redis.get(`tenant:${token}:pwHash`);
    if (!pwHash) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Invalid token' }) };
    }
    const valid = await bcrypt.compare(senhaAtual, pwHash);
    if (!valid) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Senha atual incorreta' }) };
    }
    const newHash = await bcrypt.hash(novaSenha, 10);
    await redis.set(`tenant:${token}:pwHash`, newHash);
    await redis.incr(`tenant:${token}:logoutVersion`);
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.error('changePassword error', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error' }) };
  }
}
