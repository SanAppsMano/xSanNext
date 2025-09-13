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

    const [data, pwHash] = await redisClient.mget(
      `monitor:${token}`,
      `tenant:${token}:pwHash`
    );

    let stored;
    try {
      stored = data ? (typeof data === 'string' ? JSON.parse(data) : data) : null;
    } catch {
      return error(500, 'Dados inválidos no Redis');
    }

    const empresa = stored ? stored.empresa : null;
    const schedule = stored ? stored.schedule : null;
    const tokenRedis = stored ? token : null;
    const tokenMatch = !!stored;

    const valid = pwHash ? await bcrypt.compare(senha, pwHash) : false;
    const inputHash = pwHash ? bcrypt.hashSync(senha, pwHash) : null;

    return json(200, {
      empresa,
      schedule,
      pwHash: pwHash || null,
      inputHash,
      valid,
      tokenIn: token,
      tokenRedis,
      tokenMatch,
    });
  } catch (error) {
    return errorHandler(error);
  }
}
