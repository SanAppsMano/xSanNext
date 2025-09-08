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

    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) {
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
    let prefCount = 0;
    let normCount = 0;
    const process = async (name, isPriority) => {
      const ticketNumber = await redis.incr(prefix + "ticketCounter");
      const ts = Date.now();
      const pipeline = redis.pipeline();
      pipeline.mset({
        [prefix + `ticketTime:${ticketNumber}`]: ts,
      });
      if (name) {
        pipeline.hset(prefix + "ticketNames", { [ticketNumber]: name });
      }
      if (isPriority) {
        pipeline.rpush(prefix + "priorityQueue", ticketNumber);
        pipeline.sadd(prefix + "prioritySet", String(ticketNumber));
        pipeline.sadd(prefix + "priorityHistory", String(ticketNumber));
      }
      pipeline.lpush(prefix + "log:entered", JSON.stringify({ ticket: ticketNumber, ts, name }));
      pipeline.ltrim(prefix + "log:entered", 0, 999);
      pipeline.expire(prefix + "log:entered", LOG_TTL);
      await pipeline.exec();
      return isPriority;
    };

    const CHUNK_SIZE = 20;
    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      const chunk = items.slice(i, i + CHUNK_SIZE);
      const results = await Promise.all(
        chunk.map(async (item) => {
          if (!item) return null;
          let { name, preferential: pref } = item;
          name = String(name || "").trim();
          let isPriority = Boolean(pref);
          if (name.endsWith("*")) {
            isPriority = true;
            name = name.slice(0, -1).trim();
          }
          return await process(name, isPriority);
        })
      );
      for (const isPriority of results) {
        if (isPriority === null) continue;
        total++;
        if (isPriority) prefCount++;
        else normCount++;
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, imported: total, preferential: prefCount, normal: normCount }),
    };
  } catch (error) {
    return errorHandler(error);
  }
}

