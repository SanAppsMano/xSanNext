import { Redis } from "@upstash/redis";

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  const url      = new URL(event.rawUrl);
  const tenantId = url.searchParams.get('t');
  if (!tenantId) {
    return { statusCode: 400, body: 'Missing tenantId' };
  }

  let name = '';
  try {
    const body = JSON.parse(event.body || '{}');
    name = body.name || '';
  } catch {}

  const redis  = Redis.fromEnv();
  const prefix = `tenant:${tenantId}:`;

  const ticketNumber = await redis.incr(prefix + 'ticketCounter');
  await redis.set(prefix + `ticketTime:${ticketNumber}`, Date.now());
  if (name) {
    await redis.set(prefix + `manualName:${ticketNumber}`, name);
  }

  const ts = Date.now();
  await redis.lpush(
    prefix + 'log:entered',
    JSON.stringify({ ticket: ticketNumber, name, ts, manual: true })
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ ticketNumber, name, ts })
  };
}
