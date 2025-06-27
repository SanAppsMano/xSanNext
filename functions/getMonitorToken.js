const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método não permitido' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  const { empresa, senha } = body;
  if (!empresa || !senha) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Dados incompletos' }) };
  }

  const key = `monitorByEmpresa:${empresa.toLowerCase()}`;
  try {
    const token = await redis.get(key);
    if (!token) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Empresa não encontrada' }) };
    }
    const data = await redis.get(`monitor:${token}`);
    if (!data) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Configuração não encontrada' }) };
    }
    const stored = JSON.parse(data);
    if (stored.senha !== senha) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Senha inválida' }) };
    }
    return { statusCode: 200, body: JSON.stringify({ token }) };
  } catch (err) {
    console.error('getMonitorToken error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
