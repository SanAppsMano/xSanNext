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
