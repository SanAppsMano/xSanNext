import { Redis } from "@upstash/redis";
import errorHandler from "./utils/errorHandler.js";

const LOG_TTL = 60 * 60 * 24 * 30; // 30 days

export async function handler(event) {
  try {
    const url      = new URL(event.rawUrl);
    const tenantId = url.searchParams.get("t");
    if (!tenantId) {
      return { statusCode: 400, body: "Missing tenantId" };
    }

    const redis     = Redis.fromEnv();
    const [pwHash, monitor] = await redis.mget(
      `tenant:${tenantId}:pwHash`,
      `monitor:${tenantId}`
    );
    if (!pwHash && !monitor) {
      return { statusCode: 404, body: "Invalid link" };
    }
    const prefix    = `tenant:${tenantId}:`;
    const paramNum  = url.searchParams.get("num");
    const identifier = url.searchParams.get("id") || "";

    const counterKey = prefix + "callCounter";
    const prevCounter = Number(await redis.get(counterKey) || 0);

    // Próximo a chamar
    let next;
    if (paramNum) {
      next = Number(paramNum);
      // Não atualiza o contador sequencial para manter a ordem quando
      // um número é chamado manualmente
      await redis.srem(prefix + "cancelledSet", String(next));
      await redis.srem(prefix + "missedSet", String(next));
      await redis.srem(prefix + "skippedSet", String(next));
    } else {
      next = await redis.incr(counterKey);
      const ticketCount = Number(await redis.get(prefix + "ticketCounter") || 0);
      // Se automático, pular tickets cancelados, perdidos ou pulados sem removê-los
      while (
        next <= ticketCount &&
        ((await redis.sismember(prefix + "cancelledSet", String(next))) ||
         (await redis.sismember(prefix + "missedSet", String(next))) ||
         (await redis.sismember(prefix + "skippedSet", String(next))))
      ) {
        next = await redis.incr(counterKey);
      }
    }

    await redis.srem(prefix + "offHoursSet", String(next));

    // Quando a chamada é automática (Próximo), quem perde a vez é o último
    // número chamado nessa sequência (prevCounter), independente de haver
    // chamadas manuais entre eles. Assim tickets com ou sem nome são
    // tratados igualmente.
    if (!paramNum && prevCounter && next > prevCounter) {
      const [isCancelled, isMissed, isAttended, isSkipped, joinPrev] = await Promise.all([
        redis.sismember(prefix + "cancelledSet", String(prevCounter)),
        redis.sismember(prefix + "missedSet", String(prevCounter)),
        redis.sismember(prefix + "attendedSet", String(prevCounter)),
        redis.sismember(prefix + "skippedSet", String(prevCounter)),
        redis.get(prefix + `ticketTime:${prevCounter}`)
      ]);
      if (!isCancelled && !isMissed && !isAttended && !isSkipped && joinPrev) {
        const calledTs = Number((await redis.get(prefix + `calledTime:${prevCounter}`)) || 0);
        const dur = calledTs ? Date.now() - calledTs : 0;
        const waitPrev = Number((await redis.get(prefix + `wait:${prevCounter}`)) || 0);
        await redis.sadd(prefix + "missedSet", String(prevCounter));
        const missTs = Date.now();
        // registra o momento em que o ticket perdeu a vez
        await redis.set(prefix + `cancelledTime:${prevCounter}`, missTs);
        await redis.lpush(
          prefix + "log:cancelled",
          JSON.stringify({ ticket: prevCounter, ts: missTs, reason: "missed", duration: dur, wait: waitPrev })
        );
        await redis.ltrim(prefix + "log:cancelled", 0, 999);
        await redis.expire(prefix + "log:cancelled", LOG_TTL);
        await redis.del(prefix + `wait:${prevCounter}`);
      }
    }

    const ts = Date.now();
    let wait = 0;
    const joinTs = await redis.get(prefix + `ticketTime:${next}`);
    if (joinTs) {
      wait = ts - Number(joinTs);
      // mantém ticketTime registrado para o relatório
    }
    // Atualiza dados da chamada em um único comando
    const updateData = {
      [prefix + `wait:${next}`]: wait,
      [prefix + "currentCall"]: next,
      [prefix + "currentCallTs"]: ts,
      [prefix + `calledTime:${next}`]: ts,
    };
    if (identifier) {
      updateData[prefix + `identifier:${next}`] = identifier;
      updateData[prefix + "currentAttendant"] = identifier;
    }
    await redis.mset(updateData);

    const name = await redis.hget(prefix + "ticketNames", String(next));

    // Log de chamada
    await redis.lpush(
      prefix + "log:called",
      JSON.stringify({ ticket: next, attendant: identifier, identifier, ts, wait, name })
    );
    await redis.ltrim(prefix + "log:called", 0, 999);
    await redis.expire(prefix + "log:called", LOG_TTL);

    return {
      statusCode: 200,
      body: JSON.stringify({ called: next, attendant: identifier, identifier, ts, wait, name }),
    };
  } catch (error) {
    return errorHandler(error);
  }
}
