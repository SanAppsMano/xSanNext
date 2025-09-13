import { Redis } from '@upstash/redis';
import bcrypt from 'bcryptjs';
import { error, json } from './utils/response.js';

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
    return error(405, 'Método não permitido');
  }

  let body;
  try {
    if (typeof event.body === 'string') {
      body = JSON.parse(event.body || '{}');
    } else {
      body = event.body || {};
    }
  } catch {
    return error(400, 'JSON inválido');
  }

  const { empresa, senha } = body;
  if (!empresa || !senha) {
    return error(400, 'Dados incompletos');
  }

  const empresaKey = sanitizeEmpresa(empresa);
  if (!empresaKey) {
    return error(400, 'Nome de empresa inválido');
  }

  const key = `monitorByEmpresa:${empresaKey}`;

  let redis;
  try {
    redis = Redis.fromEnv();
  } catch (err) {
    console.error('Redis init error:', err);
    return error(500, 'Erro de configuração do servidor');
  }

  try {
    const token = await redis.get(key);
    if (!token) {
      return error(404, 'Empresa não encontrada');
    }

    const [config, hash] = await redis.mget(
      `monitor:${token}`,
      `tenant:${token}:pwHash`
    );
    if (!config) {
      return error(404, 'Configuração não encontrada');
    }
    if (!hash) {
      return error(404, 'Senha não configurada');
    }

    const valid = await bcrypt.compare(senha, hash);
    if (!valid) {
      return error(403, 'Senha inválida');
    }

    return json(200, { token });
  } catch (err) {
    console.error('getMonitorToken error:', err);
    return error(500, err.message);
  }
}
