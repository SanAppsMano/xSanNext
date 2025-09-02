import { Redis } from "@upstash/redis";

const LOG_TTL = 60 * 60 * 24 * 30; // 30 days

export async function handler(event) {
  try {
    const url = new URL(event.rawUrl);
    let body = {};
    if (event.body) {
      try { body = JSON.parse(event.body); } catch {}
    }
    const token = body.token || url.searchParams.get("t");
    const ticketIdParam = body.ticket_id || url.searchParams.get("ticket_id");
    const identifier = body.identifier || url.searchParams.get("id") || "";

    if (!token) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: "token ausente" }) };
    }

    const redis = Redis.fromEnv();
    const prefix = `tenant:${token}:`;

    if (ticketIdParam) {
      const ticketId = Number(ticketIdParam);
      const ts = Date.now();
      const updateData = {
        [prefix + "currentCall"]: ticketId,
        [prefix + "currentCallTs"]: ts,
        [prefix + `calledTime:${ticketId}`]: ts,
      };
      if (identifier) updateData[prefix + "currentAttendant"] = identifier;
      await redis.mset(updateData);
      await redis.lpush(
        prefix + "log:called",
        JSON.stringify({ ticket: ticketId, attendant: identifier, ts })
      );
      await redis.ltrim(prefix + "log:called", 0, 999);
      await redis.expire(prefix + "log:called", LOG_TTL);
      return { statusCode: 200, body: JSON.stringify({ ok: true, ticket_id: ticketId }) };
    }

    const priorityKey = prefix + "priorityQueue";
    let next = await redis.lpop(priorityKey);
    if (next) {
      next = Number(next);
    } else {
      const counterKey = prefix + "callCounter";
      const ticketCounter = Number(await redis.get(prefix + "ticketCounter") || 0);
      next = Number(await redis.incr(counterKey));
      while (
        next <= ticketCounter &&
        (
          await redis.sismember(prefix + "cancelledSet", String(next)) ||
          await redis.sismember(prefix + "missedSet", String(next)) ||
          await redis.sismember(prefix + "attendedSet", String(next)) ||
          await redis.sismember(prefix + "skippedSet", String(next))
        )
      ) {
        next = Number(await redis.incr(counterKey));
      }
      if (next > ticketCounter) {
        return { statusCode: 200, body: JSON.stringify({ ok: true, message: "Sem tickets pendentes" }) };
      }
    }

    const ts = Date.now();
    const updateData = {
      [prefix + "currentCall"]: next,
      [prefix + "currentCallTs"]: ts,
      [prefix + `calledTime:${next}`]: ts,
    };
    if (identifier) updateData[prefix + "currentAttendant"] = identifier;
    await redis.mset(updateData);
    await redis.lpush(
      prefix + "log:called",
      JSON.stringify({ ticket: next, attendant: identifier, ts })
    );
    await redis.ltrim(prefix + "log:called", 0, 999);
    await redis.expire(prefix + "log:called", LOG_TTL);

    return { statusCode: 200, body: JSON.stringify({ ok: true, ticket_id: next }) };
  } catch (err) {
    console.error("chamar error", err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: "Erro interno" }) };
  }
}
