import { Redis } from "@upstash/redis";
import scanDelete from "./utils/scanDelete.js";
import errorHandler from "./utils/errorHandler.js";
import { error, json } from "./utils/response.js";

const LOG_TTL = 60 * 60 * 24 * 30; // 30 days

export async function handler(event) {
  try {
    const url        = new URL(event.rawUrl);
    const tenantId   = url.searchParams.get("t");
    const attendant  = url.searchParams.get("id") || "";
    if (!tenantId) {
      return error(400, "tenantId ausente");
    }

    const redis  = Redis.fromEnv();
    const [pwHash, monitor] = await redis.mget(
      `tenant:${tenantId}:pwHash`,
      `monitor:${tenantId}`
    );
    if (!pwHash && !monitor) {
      return error(404, "Link inválido");
    }
    const prefix = `tenant:${tenantId}:`;
    const ts     = Date.now();

    // Zera todos os contadores
    await redis.set(prefix + "ticketCounter", 0);
    await redis.set(prefix + "callCounter",  0);
    await redis.set(prefix + "currentCall",  0);
    await redis.set(prefix + "currentCallTs", ts);
    await redis.set(prefix + "currentCallPriority", 0);
    await redis.del(prefix + "currentAttendant");
    await redis.del(prefix + "cancelledSet");
    await redis.del(prefix + "missedSet");
    await redis.del(prefix + "attendedSet");
    await redis.del(prefix + "skippedSet");
    await redis.del(prefix + "offHoursSet");
    await redis.del(prefix + "priorityQueue");
    await redis.del(prefix + "prioritySet");
    await redis.del(prefix + "priorityHistory");
    await redis.del(prefix + "requeuedPrevSet");
    await redis.del(prefix + "requeuedPrev");
    await redis.del(prefix + "ticketNames");
    await redis.del(prefix + "log:entered");
    await redis.del(prefix + "log:called");
    await redis.del(prefix + "log:attended");
    await redis.del(prefix + "log:cancelled");
    await redis.del(prefix + "log:reset");
    await scanDelete(redis, prefix + "ticketTime:*");
    await scanDelete(redis, prefix + "calledTime:*");
    await scanDelete(redis, prefix + "attendedTime:*");
    await scanDelete(redis, prefix + "cancelledTime:*");
    await scanDelete(redis, prefix + "wait:*");

    // Log de reset
    await redis.lpush(
      prefix + "log:reset",
      JSON.stringify({ attendant, ts })
    );
    await redis.ltrim(prefix + "log:reset", 0, 999);
    await redis.expire(prefix + "log:reset", LOG_TTL);

    return json(200, { reset: true, attendant, ts });
  } catch (error) {
    return errorHandler(error);
  }
}
