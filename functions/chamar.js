import { Redis } from "@upstash/redis";

// Obter hash de um ticket. Garante objeto vazio se inexistente.
async function getHash(redis, key) {
  const data = await redis.hgetall(key);
  return data || {};
}

// Busca próximo ticket pendente em uma lista, limpando itens inválidos.
async function pickPendingFromList(redis, prefix, listKey) {
  let len = await redis.llen(listKey);
  while (len-- > 0) {
    const ticketId = await redis.lindex(listKey, 0);
    if (!ticketId) break;
    const t = await getHash(redis, `${prefix}:ticket:${ticketId}`);
    if (t && t.status === 'pending') {
      await redis.lpop(listKey);
      return ticketId;
    }
    // remove itens que não estão pendentes
    await redis.lpop(listKey);
  }
  return null;
}

// Atualiza dados de chamada de um ticket.
async function callTicket(redis, prefix, ticketId) {
  const key = `${prefix}:ticket:${ticketId}`;
  const now = Date.now();
  await redis.hset(key, { status: 'called', called_at: String(now) });
  await redis.hincrby(key, 'call_count', 1);
  await redis.set(`${prefix}:last_called_ticket`, ticketId);
  await redis.lpush(`${prefix}:log:called`, JSON.stringify({ ticketId, ts: now }));
  return ticketId;
}

export async function handler(event) {
  try {
    let body = {};
    if (event.body) {
      try { body = JSON.parse(event.body); } catch {}
    }
    const { token, ticket_id } = body;
    if (!token) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'token ausente' }) };
    }

    const redis = Redis.fromEnv();
    const prefix = `tenant:${token}`;
    if (ticket_id) {
      const t = await getHash(redis, `${prefix}:ticket:${ticket_id}`);
      if (!t || t.status !== 'called') {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'ticket invalido' }) };
      }
      await callTicket(redis, prefix, ticket_id);
      return { statusCode: 200, body: JSON.stringify({ ok: true, ticket_id }) };
    }
    const prefList = `${prefix}:queue:preferential`;
    const normList = `${prefix}:queue:normal`;

    // 1) preferencial pendente; 2) normal pendente
    let ticketId = await pickPendingFromList(redis, prefix, prefList);
    if (!ticketId) ticketId = await pickPendingFromList(redis, prefix, normList);

    if (!ticketId) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, message: 'Sem tickets pendentes' }) };
    }

    await callTicket(redis, prefix, ticketId);
    return { statusCode: 200, body: JSON.stringify({ ok: true, ticket_id: ticketId }) };
  } catch (err) {
    console.error('chamar error', err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Erro interno' }) };
  }
}

