import { Redis } from "@upstash/redis";
import { v4 as uuidv4 } from "uuid";

export async function handler(event) {
  const url      = new URL(event.rawUrl);
  const tenantId = url.searchParams.get("t");
  if (!tenantId) {
    return { statusCode: 400, body: "Missing tenantId" };
  }

  const body = event.body ? JSON.parse(event.body) : {};
  const name = body.name || url.searchParams.get('name');

  const redis  = Redis.fromEnv();
  const prefix = `tenant:${tenantId}:`;

  // Cria clientId e incrementa contador de tickets
  const clientId     = uuidv4();
  const ticketNumber = await redis.incr(prefix + "ticketCounter");
  await redis.set(prefix + `ticket:${clientId}`, ticketNumber);
  // registra quando o cliente entrou na fila
  await redis.set(prefix + `ticketTime:${ticketNumber}`, Date.now());
  if (name) {
    await redis.set(prefix + `name:${ticketNumber}`, name);
  }

  // Log de entrada
  const ts = Date.now();
  await redis.lpush(prefix + "log:entered", JSON.stringify({ ticket: ticketNumber, ts, name }));

  return {
    statusCode: 200,
    body: JSON.stringify({ clientId, ticketNumber, ts, name }),
  };
}
