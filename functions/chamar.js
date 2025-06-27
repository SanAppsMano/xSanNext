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

  const counterKey = prefix + "callCounter";
  const prevCounter = Number(await redis.get(counterKey) || 0);

  // Próximo a chamar
  let next;
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

  // Quando a chamada é automática (Próximo), quem perde a vez é o último
  // número chamado nessa sequência (prevCounter), independente de haver
  // chamadas manuais entre eles. Assim tickets com ou sem nome são
  // tratados igualmente.
  if (!paramNum && prevCounter && next > prevCounter) {
    const [isCancelled, isMissed, isAttended] = await Promise.all([
      redis.sismember(prefix + "cancelledSet", String(prevCounter)),
      redis.sismember(prefix + "missedSet", String(prevCounter)),
      redis.sismember(prefix + "attendedSet", String(prevCounter))
    ]);
    if (!isCancelled && !isMissed && !isAttended) {
      const calledTs = Number(await redis.get(prefix + `calledTime:${prevCounter}`) || 0);
      const dur = calledTs ? Date.now() - calledTs : 0;
      const waitPrev = Number(await redis.get(prefix + `wait:${prevCounter}`) || 0);
      await redis.sadd(prefix + "missedSet", String(prevCounter));
      const missTs = Date.now();
      // registra o momento em que o ticket perdeu a vez
      await redis.set(prefix + `cancelledTime:${prevCounter}`, missTs);
      await redis.lpush(
        prefix + "log:cancelled",
        JSON.stringify({ ticket: prevCounter, ts: missTs, reason: "missed", duration: dur, wait: waitPrev })
      );
      await redis.del(prefix + `wait:${prevCounter}`);
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
