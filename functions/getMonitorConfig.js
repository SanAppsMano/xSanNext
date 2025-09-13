import { Redis } from '@upstash/redis';
import errorHandler from './utils/errorHandler.js';
import bcrypt from 'bcryptjs';
import { error, json } from './utils/response.js';

const redisClient = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return error(405, 'Método não permitido');
    }

    let body;
    try {
      body = JSON.parse(event.body);
    } catch {
      return error(400, 'JSON inválido');
    }

    const { token, senha } = body;
    if (!token || !senha) {
      return error(400, 'Token ou senha ausente');
    }

    const [data, hash] = await redisClient.mget(
      `monitor:${token}`,
      `tenant:${token}:pwHash`
    );

    if (!data) {
      return error(404, 'Configuração não encontrada');
    }
    if (!hash) {
      return error(404, 'Senha não configurada');
    }

    let stored;
    try {
      stored = data ? (typeof data === 'string' ? JSON.parse(data) : data) : null;
    } catch {
      return error(500, 'Dados inválidos no Redis');
    }

    if (!stored) {
      return error(404, 'Configuração não encontrada');
    }

    const valid = await bcrypt.compare(senha, hash);
    if (!valid) {
      return error(403, 'Senha inválida');
    }

    let schedule = stored.schedule;
    if (!schedule) {
      try {
        const schedRaw = await redisClient.get(`tenant:${token}:schedule`);
        if (schedRaw) {
          schedule = typeof schedRaw === 'string' ? JSON.parse(schedRaw) : schedRaw;
        }
      } catch {
        /* ignore */
      }
    }
    const preferentialDesk = stored.preferentialDesk !== false;

    return json(200, { empresa: stored.empresa, schedule, preferentialDesk });
  } catch (error) {
    return errorHandler(error);
  }
}
