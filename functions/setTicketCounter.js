import { Redis } from "@upstash/redis";
import errorHandler from "./utils/errorHandler.js";
import { error, json } from "./utils/response.js";

export async function handler(event) {
  try {
    const url = new URL(event.rawUrl);
    const tenantId = url.searchParams.get("t");
    if (!tenantId) {
      return error(400, "tenantId ausente");
    }
    const { ticket } = JSON.parse(event.body || "{}");
    const nextTicket = Number(ticket);
    if (!nextTicket) {
      return error(400, "Ticket ausente");
    }
    const redis = Redis.fromEnv();
    const [pwHash, monitor] = await redis.mget(
      `tenant:${tenantId}:pwHash`,
      `monitor:${tenantId}`
    );
    if (!pwHash && !monitor) {
      return error(404, "Link inválido");
    }
    const prefix = `tenant:${tenantId}:`;
    const last   = Number(await redis.get(prefix + "ticketCounter") || 0);
    const called = Number(await redis.get(prefix + "callCounter") || 0);
    if (nextTicket <= last) {
      return error(400, "O ticket deve ser maior que o último");
    }

    const gap = nextTicket - last - 1; // números pulados

    await redis.mset({
      [prefix + "ticketCounter"]: nextTicket - 1,
      ...(called >= last ? { [prefix + "callCounter"]: nextTicket - 1 } : {}),
    });

    if (called >= last) {
      await redis.del(prefix + "skippedSet");
    } else if (gap > 0) {
      const skips = Array.from({ length: gap }, (_, i) => String(last + 1 + i));
      await redis.sadd(prefix + "skippedSet", ...skips);
    }
    return json(200, { ok: true, ticketNumber: nextTicket });
  } catch (error) {
    return errorHandler(error);
  }
}
