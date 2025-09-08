import { redis } from "../utils/redis.js";
import { KEY, toScore } from "../utils/tickets.js";

const LOG_TTL = 60 * 60 * 24 * 30; // 30 days

async function popMin(key) {
  const arr = await redis.zrange(key, 0, 0);
  const member = arr?.[0];
  if (!member) return null;
  await redis.zrem(key, member);
  const numero = toScore(member);
  return Number.isFinite(numero) ? numero : null;
}

export async function handler(event) {
  const url = new URL(event.rawUrl);
  const tenantId = url.searchParams.get("t");
  const priorityParam = url.searchParams.get("priority");
  const priority = priorityParam === "1" || priorityParam === "true";
  const attendant = (url.searchParams.get("id") || "").trim();

  if (!tenantId) {
    return { statusCode: 400, body: "Missing tenantId" };
  }

  const [pwHash, monitor] = await redis.mget(
    `tenant:${tenantId}:pwHash`,
    `monitor:${tenantId}`
  );
  if (!pwHash && !monitor) {
    return { statusCode: 404, body: "Invalid link" };
  }

  const prefix = `tenant:${tenantId}:`;
  const now = Date.now();

  const prevCall = Number((await redis.get(prefix + "currentCall")) || 0);
  if (prevCall > 0) {
    const prevCallTs = Number((await redis.get(prefix + "currentCallTs")) || 0);
    const duration = prevCallTs ? now - prevCallTs : 0;
    await redis.sadd(prefix + "missedSet", String(prevCall));
    await redis.srem(prefix + "prioritySet", String(prevCall));
    await redis.lrem(prefix + "priorityQueue", 0, String(prevCall));
    await redis.set(prefix + `cancelledTime:${prevCall}`, now);
    await redis.lpush(
      prefix + "log:cancelled",
      JSON.stringify({ ticket: prevCall, ts: now, reason: "missed", duration })
    );
    await redis.ltrim(prefix + "log:cancelled", 0, 999);
    await redis.expire(prefix + "log:cancelled", LOG_TTL);
  }

  let numero = null;
  let tipo = "normal";

  if (priority) {
    numero = await popMin(KEY(tenantId, "preferencial"));
    if (numero == null) {
      numero = await popMin(KEY(tenantId, "normal"));
    } else {
      tipo = "preferencial";
    }
  } else {
    numero = await popMin(KEY(tenantId, "normal"));
    if (numero == null) {
      numero = await popMin(KEY(tenantId, "preferencial"));
      if (numero != null) tipo = "preferencial";
    }
  }

  if (numero == null) {
    return { statusCode: 400, body: "Sem tickets para chamar" };
  }

  if (tipo === "preferencial") {
    await redis.lrem(prefix + "priorityQueue", 0, String(numero));
  }

  const joinTs = await redis.get(prefix + `ticketTime:${numero}`);
  const wait = joinTs ? now - Number(joinTs) : 0;
  await redis.set(prefix + `wait:${numero}`, wait);

  await redis.mset({
    [prefix + "currentCall"]: numero,
    [prefix + "currentCallTs"]: now,
    [prefix + "currentCallPriority"]: tipo === "preferencial" ? 1 : 0,
  });
  if (attendant) {
    await redis.set(prefix + "currentAttendant", attendant);
  } else {
    await redis.del(prefix + "currentAttendant");
  }
  await redis.incr(prefix + "callCounter");
  await redis.set(prefix + `calledTime:${numero}`, now);
  await redis.lpush(
    prefix + "log:called",
    JSON.stringify({ ticket: numero, ts: now, attendant, wait })
  );
  await redis.ltrim(prefix + "log:called", 0, 999);
  await redis.expire(prefix + "log:called", LOG_TTL);

  return {
    statusCode: 200,
    body: JSON.stringify({ called: numero, attendant }),
  };
}

