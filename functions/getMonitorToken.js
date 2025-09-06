import { Redis } from '@upstash/redis';
import bcrypt from 'bcryptjs';

function sanitizeEmpresa(name) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, '');
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Método não permitido' })
    };
  }

  let body;
  try {
    if (typeof event.body === 'string') {
      body = JSON.parse(event.body || '{}');
    } else {
      body = event.body || {};
    }
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  const { empresa, senha } = body;
  if (!empresa || !senha) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Dados incompletos' }) };
  }

  const empresaKey = sanitizeEmpresa(empresa);
  if (!empresaKey) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Nome de empresa inválido' }) };
  }

  const key = `monitorByEmpresa:${empresaKey}`;

  let redis;
  try {
    redis = Redis.fromEnv();
  } catch (err) {
    console.error('Redis init error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server configuration error' })
    };
  }

  try {
    const token = await redis.get(key);
    if (!token) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Empresa não encontrada' }) };
    }

    const [config, hash] = await redis.mget(
      `monitor:${token}`,
      `tenant:${token}:pwHash`
    );
    if (!config) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Configuração não encontrada' }) };
    }
    if (!hash) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Senha não configurada' }) };
    }

    const valid = await bcrypt.compare(senha, hash);
    if (!valid) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Senha inválida' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ token }) };
  } catch (err) {
    console.error('getMonitorToken error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
