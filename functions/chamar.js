import { Redis } from "@upstash/redis";

export async function handler(event) {
  const url      = new URL(event.rawUrl);
  const tenantId = url.searchParams.get("t");
  if (!tenantId) {
    return { statusCode: 400, body: "Missing tenantId" };
  }

  const redis     = Redis.fromEnv();
  const prefix    = `tenant:${tenantId}:`;
  const paramNum  = url.searchParams.get("num");
  const attendant = url.searchParams.get("id") || "";

  const prevCall   = Number(await redis.get(prefix + "currentCall") || 0);
  const prevCallTs = Number(await redis.get(prefix + "currentCallTs") || 0);

  // Próximo a chamar
  let next;
  const counterKey = prefix + "callCounter";
  if (paramNum) {
    next = Number(paramNum);
    // Não atualiza o contador sequencial para manter a ordem quando
    // um número é chamado manualmente
    await redis.srem(prefix + "cancelledSet", String(next));
    await redis.srem(prefix + "missedSet", String(next));
  } else {
    next = await redis.incr(counterKey);
    const ticketCount = Number(await redis.get(prefix + "ticketCounter") || 0);
    // Se automático, pular tickets cancelados e perdidos sem removê-los
    while (
      next <= ticketCount &&
      ((await redis.sismember(prefix + "cancelledSet", String(next))) ||
       (await redis.sismember(prefix + "missedSet", String(next))))
    ) {
      next = await redis.incr(counterKey);
    }
  }

  // Quando um número é chamado manualmente (paramNum),
  // não devemos marcar o chamado anterior como perdido,
  // pois ele continua aguardando na fila
  if (!paramNum && prevCall && prevCall !== next) {
    const [isCancelled, isMissed, isAttended] = await Promise.all([
      redis.sismember(prefix + "cancelledSet", String(prevCall)),
      redis.sismember(prefix + "missedSet", String(prevCall)),
      redis.sismember(prefix + "attendedSet", String(prevCall))
    ]);
    if (!isCancelled && !isMissed && !isAttended) {
      const dur = prevCallTs ? Date.now() - prevCallTs : 0;
      const waitPrev = Number(await redis.get(prefix + `wait:${prevCall}`) || 0);
      await redis.sadd(prefix + "missedSet", String(prevCall));
      const missTs = Date.now();
      // registra o momento em que o ticket perdeu a vez
      await redis.set(prefix + `cancelledTime:${prevCall}`, missTs);
      await redis.lpush(
        prefix + "log:cancelled",
        JSON.stringify({ ticket: prevCall, ts: missTs, reason: "missed", duration: dur, wait: waitPrev })
      );
      await redis.del(prefix + `wait:${prevCall}`);
    }
  }

  const ts = Date.now();
  let wait = 0;
  const joinTs = await redis.get(prefix + `ticketTime:${next}`);
  if (joinTs) {
    wait = ts - Number(joinTs);
    // mantém ticketTime registrado para o relatório
  }
  await redis.set(prefix + `wait:${next}`, wait);
  await redis.set(prefix + "currentCall", next);
  await redis.set(prefix + "currentCallTs", ts);
  if (attendant) {
    await redis.set(prefix + "currentAttendant", attendant);
  }

  const name = await redis.hget(prefix + "ticketNames", String(next));

  // Armazena o timestamp da chamada para consulta posterior
  await redis.set(prefix + `calledTime:${next}`, ts);

  // Log de chamada
  await redis.lpush(
    prefix + "log:called",
    JSON.stringify({ ticket: next, attendant, ts, wait, name })
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ called: next, attendant, ts, wait, name }),
  };
}
