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
    const currentCounter = Number(await redis.get(counterKey) || 0);
    if (next > currentCounter) {
      await redis.set(counterKey, next);
    }
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

  if (prevCall && prevCall !== next) {
    const [isCancelled, isMissed, isAttended] = await Promise.all([
      redis.sismember(prefix + "cancelledSet", String(prevCall)),
      redis.sismember(prefix + "missedSet", String(prevCall)),
      redis.sismember(prefix + "attendedSet", String(prevCall))
    ]);
    if (!isCancelled && !isMissed && !isAttended) {
      const dur = prevCallTs ? Date.now() - prevCallTs : 0;
      const waitPrev = Number(await redis.get(prefix + `wait:${prevCall}`) || 0);
      await redis.sadd(prefix + "missedSet", String(prevCall));
      await redis.lpush(
        prefix + "log:cancelled",
        JSON.stringify({ ticket: prevCall, ts: Date.now(), reason: "missed", duration: dur, wait: waitPrev })
      );
      await redis.del(prefix + `wait:${prevCall}`);
    }
  }

  const ts = Date.now();
  let wait = 0;
  const joinTs = await redis.get(prefix + `ticketTime:${next}`);
  if (joinTs) {
    wait = ts - Number(joinTs);
    await redis.del(prefix + `ticketTime:${next}`);
  }
  await redis.set(prefix + `wait:${next}`, wait);
  await redis.set(prefix + "currentCall", next);
  await redis.set(prefix + "currentCallTs", ts);
  if (attendant) {
    await redis.set(prefix + "currentAttendant", attendant);
  }

  // Log de chamada
  await redis.lpush(
    prefix + "log:called",
    JSON.stringify({ ticket: next, attendant, ts, wait })
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ called: next, attendant, ts, wait }),
  };
}
