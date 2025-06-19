import { Redis } from "@upstash/redis";

export async function handler(event) {
  const url        = new URL(event.rawUrl);
  const tenantId   = url.searchParams.get("t");
  const attendant  = url.searchParams.get("id") || "";
  if (!tenantId) {
    return { statusCode: 400, body: "Missing tenantId" };
  }

  const redis  = Redis.fromEnv();
  const prefix = `tenant:${tenantId}:`;
  const ts     = Date.now();

  // Zera todos os contadores
  await redis.set(prefix + "ticketCounter", 0);
  await redis.set(prefix + "callCounter",  0);
  await redis.set(prefix + "currentCall",  0);
  await redis.set(prefix + "currentCallTs", ts);
  await redis.del(prefix + "currentAttendant");
  await redis.del(prefix + "cancelledSet");
  await redis.del(prefix + "missedSet");
  await redis.del(prefix + "attendedSet");
  await redis.del(prefix + "ticketNames");
  await redis.del(prefix + "log:entered");
  await redis.del(prefix + "log:called");
  await redis.del(prefix + "log:attended");
  await redis.del(prefix + "log:cancelled");
  await redis.del(prefix + "log:reset");
  const keys = await redis.keys(prefix + "ticketTime:*");
  for (const k of keys) await redis.del(k);
  const calledKeys = await redis.keys(prefix + "calledTime:*");
  for (const k of calledKeys) await redis.del(k);
  const attendedKeys = await redis.keys(prefix + "attendedTime:*");
  for (const k of attendedKeys) await redis.del(k);
  const cancelledKeys = await redis.keys(prefix + "cancelledTime:*");
  for (const k of cancelledKeys) await redis.del(k);
  const waitKeys = await redis.keys(prefix + "wait:*");
  for (const w of waitKeys) await redis.del(w);

  // Log de reset
  await redis.lpush(
    prefix + "log:reset",
    JSON.stringify({ attendant, ts })
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ reset: true, attendant, ts }),
  };
}
