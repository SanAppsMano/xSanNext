import { Redis } from "@upstash/redis";

const LOG_TTL = 60 * 60 * 24 * 30; // 30 days

export async function handler(event) {
  const url = new URL(event.rawUrl);
  const tenantId = url.searchParams.get("t");
  if (!tenantId) {
    return { statusCode: 400, body: "Missing tenantId" };
  }

  const redis = Redis.fromEnv();
  const [pwHash, monitor] = await redis.mget(
    `tenant:${tenantId}:pwHash`,
    `monitor:${tenantId}`
  );
  if (!pwHash && !monitor) {
    return { statusCode: 404, body: "Invalid link" };
  }
  const { name = "", priority: bodyPriority } = JSON.parse(event.body || "{}");
  const priorityParam = bodyPriority ?? url.searchParams.get("priority");
  const priority = priorityParam === true || priorityParam === "true";

  const prefix = `tenant:${tenantId}:`;

  const ticketNumber = await redis.incr(prefix + "ticketCounter");
  await redis.set(prefix + `ticketTime:${ticketNumber}`, Date.now());
  if (name) {
    await redis.hset(prefix + "ticketNames", { [ticketNumber]: name });
  }

  if (priority) {
    await redis.rpush(prefix + "priorityQueue", ticketNumber);
    await redis.sadd(prefix + "prioritySet", String(ticketNumber));
    await redis.sadd(prefix + "priorityHistory", String(ticketNumber));
  }

  const ts = Date.now();
  await redis.lpush(prefix + "log:entered", JSON.stringify({ ticket: ticketNumber, ts, name }));
  await redis.ltrim(prefix + "log:entered", 0, 999);
  await redis.expire(prefix + "log:entered", LOG_TTL);

  return {
    statusCode: 200,
    body: JSON.stringify({ ticketNumber, name, ts }),
  };
}
