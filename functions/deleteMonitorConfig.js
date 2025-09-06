// functions/deleteMonitorConfig.js

const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});

function sanitizeEmpresa(name) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, '');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Método não permitido' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'JSON inválido' })
    };
  }

  const { token } = body;
  if (!token) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Token ausente' })
    };
  }

  try {
    const data = await redis.get(`monitor:${token}`);
    let empresa;
    if (data) {
      try { empresa = JSON.parse(data).empresa; } catch {}
    }
    // Remove também índice possivelmente cadastrado (tenantByEmail), se existir
    const keys = [`monitor:${token}`, `tenantByEmail:${token}`];
    if (empresa) {
      const empresaKey = sanitizeEmpresa(empresa);
      if (empresaKey) {
        keys.push(`monitorByEmpresa:${empresaKey}`);
      }
    }
    await redis.del(...keys);

    // Apaga todas as chaves do tenant (contadores, pwHash, label, tickets, logs...)
    // usando SCAN/DEL para remover conjuntos e hashes da fila
    const prefix = `tenant:${token}:`;
    let cursor = 0;
    do {
      const [next, found] = await redis.scan(cursor, {
        match: `${prefix}*`,
        count: 100,
      });
      if (found.length > 0) {
        await redis.del(...found);
      }
      cursor = Number(next);
    } while (cursor !== 0);

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true })
    };
  } catch (err) {
    console.error('Erro ao deletar no Redis:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
