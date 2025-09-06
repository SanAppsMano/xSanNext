import { Redis } from "@upstash/redis";
import errorHandler from "./utils/errorHandler.js";

const LOG_TTL = 60 * 60 * 24 * 30; // 30 days

export async function handler(event) {
  try {
    const url = new URL(event.rawUrl);
    const tenantId = url.searchParams.get("t");
    if (!tenantId) {
      return { statusCode: 400, body: "Missing tenantId" };
    }

    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {}

    const normal = Array.isArray(body.normal) ? body.normal : [];
    const preferential = Array.isArray(body.preferential || body.priority) ? (body.preferential || body.priority) : [];
    if (normal.length === 0 && preferential.length === 0) {
      return { statusCode: 400, body: "Empty list" };
    }

    const redis = Redis.fromEnv();
    const [pwHash, monitor] = await redis.mget(
      `tenant:${tenantId}:pwHash`,
      `monitor:${tenantId}`
    );
    if (!pwHash && !monitor) {
      return { statusCode: 404, body: "Invalid link" };
    }

    const prefix = `tenant:${tenantId}:`;
    let total = 0;
    const process = async (name, isPriority) => {
      const ticketNumber = await redis.incr(prefix + "ticketCounter");
      const ts = Date.now();
      const data = {
        [prefix + `ticketTime:${ticketNumber}`]: ts,
      };
      await redis.mset(data);
      if (name) {
        await redis.hset(prefix + "ticketNames", { [ticketNumber]: name });
      }
      if (isPriority) {
        await redis.rpush(prefix + "priorityQueue", ticketNumber);
        await redis.sadd(prefix + "prioritySet", String(ticketNumber));
        await redis.sadd(prefix + "priorityHistory", String(ticketNumber));
      }
      await redis.lpush(prefix + "log:entered", JSON.stringify({ ticket: ticketNumber, ts, name }));
      await redis.ltrim(prefix + "log:entered", 0, 999);
      await redis.expire(prefix + "log:entered", LOG_TTL);
      total++;
    };

    for (const name of preferential) {
      await process(name, true);
    }
    for (const name of normal) {
      await process(name, false);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, imported: total, preferential: preferential.length, normal: normal.length }),
    };
  } catch (error) {
    return errorHandler(error);
  }
}

