import { Redis } from "@upstash/redis";

const LOG_TTL = 60 * 60 * 24 * 30; // 30 days

export async function handler(event) {
  const url      = new URL(event.rawUrl);
  const tenantId = url.searchParams.get("t");
  if (!tenantId) {
    return { statusCode: 400, body: "Missing tenantId" };
  }

  const { ticket } = JSON.parse(event.body || "{}");
  if (!ticket) {
    return { statusCode: 400, body: "Missing ticket" };
  }

  const redis  = Redis.fromEnv();
  const prefix = `tenant:${tenantId}:`;

  const ticketStr = String(ticket);
  await redis.sadd(prefix + "attendedSet", ticketStr);
  await redis.srem(prefix + "cancelledSet", ticketStr);
  await redis.srem(prefix + "missedSet", ticketStr);

  // Remove eventuais registros de perda de vez
  const missRaw = await redis.lrange(prefix + "log:cancelled", 0, -1);
  for (const item of missRaw) {
    try {
      const obj = JSON.parse(item);
      if (obj.ticket === Number(ticket) && obj.reason === "missed") {
        await redis.lrem(prefix + "log:cancelled", 0, item);
      }
    } catch {}
  }

  const [callTsRaw, waitRaw] = await redis.mget(
    prefix + "currentCallTs",
    prefix + `wait:${ticket}`
  );
  const callTs  = Number(callTsRaw || 0);
  const duration = callTs ? Date.now() - callTs : 0;
  const wait     = Number(waitRaw || 0);
  await redis.del(prefix + `wait:${ticket}`);

  // Limpa a chamada atual para evitar que o número seja marcado como perdido
  await redis.mset({
    [prefix + "currentCall"]: 0,
    [prefix + "currentCallTs"]: 0,
  });
  await redis.del(prefix + "currentAttendant");

  // registra a finalização do atendimento
  const ts = Date.now();
  await redis.set(prefix + `attendedTime:${ticket}`, ts);
  await redis.lpush(
    prefix + "log:attended",
    JSON.stringify({ ticket: Number(ticket), ts, duration, wait })
  );
  await redis.ltrim(prefix + "log:attended", 0, 999);
  await redis.expire(prefix + "log:attended", LOG_TTL);

  return {
    statusCode: 200,
    body: JSON.stringify({ attended: true, ticket: Number(ticket), duration, wait, ts }),
  };
}
