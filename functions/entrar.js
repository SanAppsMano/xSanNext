import { Redis } from "@upstash/redis";
import { v4 as uuidv4 } from "uuid";

export async function handler(event) {
  const url      = new URL(event.rawUrl);
  const tenantId = url.searchParams.get("t");
  if (!tenantId) {
    return { statusCode: 400, body: "Missing tenantId" };
  }

  const redis  = Redis.fromEnv();
  const prefix = `tenant:${tenantId}:`;

  let subscription = null;
  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body || '{}');
      subscription = body.subscription || null;
    } catch {}
  }

  // Cria clientId e incrementa contador de tickets
  const clientId     = uuidv4();
  const ticketNumber = await redis.incr(prefix + "ticketCounter");
  await redis.set(prefix + `ticket:${clientId}`, ticketNumber);
  await redis.set(prefix + `ticketTime:${ticketNumber}`, Date.now());
  if (subscription) {
    await redis.set(prefix + `subscription:${ticketNumber}`, JSON.stringify(subscription));
  }

  // Log de entrada
  const ts = Date.now();
  await redis.lpush(prefix + "log:entered", JSON.stringify({ ticket: ticketNumber, ts }));

  return {
    statusCode: 200,
    body: JSON.stringify({ clientId, ticketNumber, ts }),
  };
}
