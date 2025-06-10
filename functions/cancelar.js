import { Redis } from "@upstash/redis";

export async function handler(event) {
  const url      = new URL(event.rawUrl);
  const tenantId = url.searchParams.get("t");
  if (!tenantId) {
    return { statusCode: 400, body: "Missing tenantId" };
  }

  const { clientId, reason = "client", duration } = JSON.parse(event.body || "{}");
  const redis  = Redis.fromEnv();
  const prefix = `tenant:${tenantId}:`;

  // Recupera e remove ticket do cliente
  const ticketNum = await redis.get(prefix + `ticket:${clientId}`);
  await redis.del(prefix + `ticket:${clientId}`);

  let wait = 0;
  if (ticketNum) {
    const joinTs = await redis.get(prefix + `ticketTime:${ticketNum}`);
    if (joinTs) {
      wait = Date.now() - Number(joinTs);
    }
    await redis.del(prefix + `ticketTime:${ticketNum}`);
  }

  const attended = ticketNum
    ? await redis.sismember(prefix + "attendedSet", String(ticketNum))
    : false;

  // Se havia ticket e não foi atendido, marca cancelamento
  if (ticketNum && !attended) {
    if (reason === "missed") {
      await redis.sadd(prefix + "missedSet", String(ticketNum));
    } else {
      await redis.sadd(prefix + "cancelledSet", String(ticketNum));
    }
    // Log de cancelamento
    const ts = Date.now();
    await redis.lpush(
      prefix + "log:cancelled",
      JSON.stringify({ ticket: Number(ticketNum), ts, reason, duration: duration ? Number(duration) : 0, wait })
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ cancelled: true, ticket: Number(ticketNum), ts, reason, duration: duration ? Number(duration) : 0, wait }),
    };
  }

  // Se já havia sido atendido, apenas confirme
  if (ticketNum && attended) {
    return {
      statusCode: 200,
      body: JSON.stringify({ alreadyAttended: true, ticket: Number(ticketNum) }),
    };
  }

  // Nada a cancelar
  return { statusCode: 200, body: JSON.stringify({ cancelled: false }) };
}
