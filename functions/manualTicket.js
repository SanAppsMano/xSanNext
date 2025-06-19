import { Redis } from "@upstash/redis";

export async function handler(event) {
  const url = new URL(event.rawUrl);
  const tenantId = url.searchParams.get("t");
  if (!tenantId) {
    return { statusCode: 400, body: "Missing tenantId" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const name = (body.name || "").trim();
  if (!name) {
    return { statusCode: 400, body: "Missing name" };
  }

  const redis = Redis.fromEnv();
  const prefix = `tenant:${tenantId}:`;

  const ticketNumber = await redis.incr(prefix + "ticketCounter");
  await redis.set(prefix + `ticketName:${ticketNumber}`, name);
  await redis.set(prefix + `ticketTime:${ticketNumber}`, Date.now());

  const ts = Date.now();
  await redis.lpush(prefix + "log:entered", JSON.stringify({ ticket: ticketNumber, ts, name }));

  return {
    statusCode: 200,
    body: JSON.stringify({ ticketNumber, name, ts })
  };
}
