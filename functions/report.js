import { Redis } from "@upstash/redis";

export async function handler(event) {
  const url = new URL(event.rawUrl);
  const tenantId = url.searchParams.get("t");
  if (!tenantId) {
    return { statusCode: 400, body: "Missing tenantId" };
  }

  const redis = Redis.fromEnv();
  const prefix = `tenant:${tenantId}:`;

  const logs = await Promise.all([
    redis.lrange(prefix + "log:entered", 0, -1),
    redis.lrange(prefix + "log:called", 0, -1),
    redis.lrange(prefix + "log:attended", 0, -1),
    redis.lrange(prefix + "log:cancelled", 0, -1),
  ]);

  const [enteredRaw, calledRaw, attendedRaw, cancelledRaw] = logs;

  return {
    statusCode: 200,
    body: JSON.stringify({
      entered: enteredRaw.map(s => JSON.parse(s)),
      called: calledRaw.map(s => JSON.parse(s)),
      attended: attendedRaw.map(s => JSON.parse(s)),
      cancelled: cancelledRaw.map(s => JSON.parse(s)),
    }),
  };
}
