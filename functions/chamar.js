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
    const priorityOnly = url.searchParams.get("priority") === "1";
    const identifier = url.searchParams.get("id") || "";
    const currentCallPrev = Number(await redis.get(prefix + "currentCall") || 0);
    const requeuedPrevSetKey = prefix + "requeuedPrevSet";
    const legacyRequeuedKey = prefix + "requeuedPrev";
    const legacyRequeued = await redis.get(legacyRequeuedKey);
    if (legacyRequeued) {
      await redis.sadd(requeuedPrevSetKey, legacyRequeued);
      await redis.del(legacyRequeuedKey);
    }
    let p = null;
    if (!paramNum && priorityOnly) {
      p = await redis.lpop(prefix + "priorityQueue");
      if (!p) {
        return { statusCode: 404, body: "Sem tickets preferenciais" };
      }
    }
    let isPriorityCall = priorityOnly;
    if (!isPriorityCall && p) {
      isPriorityCall = await redis.sismember(prefix + "prioritySet", String(p));
    }
    if (!isPriorityCall && paramNum) {
      isPriorityCall = await redis.sismember(prefix + "prioritySet", String(paramNum));
    }

    const counterKey = prefix + "callCounter";
    const prevCounter = Number(await redis.get(counterKey) || 0);

    if (isPriorityCall && currentCallPrev && currentCallPrev !== Number(p)) {
      const [isCancelled, isMissed, isAttended, isSkipped, joinPrev] = await Promise.all([
        redis.sismember(prefix + "cancelledSet", String(currentCallPrev)),
        redis.sismember(prefix + "missedSet", String(currentCallPrev)),
        redis.sismember(prefix + "attendedSet", String(currentCallPrev)),
        redis.sismember(prefix + "skippedSet", String(currentCallPrev)),
        redis.get(prefix + `ticketTime:${currentCallPrev}`),
      ]);
      if (!isCancelled && !isMissed && !isAttended && !isSkipped && joinPrev) {
        await redis.lpush(prefix + "priorityQueue", currentCallPrev);
        await redis.sadd(requeuedPrevSetKey, String(currentCallPrev));
      }
    }

    // Próximo a chamar
    let next;
    if (paramNum) {
      next = Number(paramNum);
      const [isCancelled, isMissed, isAttended, joinTs] = await Promise.all([
        redis.sismember(prefix + "cancelledSet", String(next)),
        redis.sismember(prefix + "missedSet", String(next)),
        redis.sismember(prefix + "attendedSet", String(next)),
        redis.get(prefix + `ticketTime:${next}`),
      ]);
      if (isCancelled || isMissed || isAttended || !joinTs) {
        return { statusCode: 400, body: "Ticket não está na fila" };
      }
      await redis.srem(prefix + "skippedSet", String(next));
    } else if (p) {
      while (p) {
        const candidate = Number(p);
        const [isCancelled, isMissed, isAttended, joinTs] = await Promise.all([
          redis.sismember(prefix + "cancelledSet", String(candidate)),
          redis.sismember(prefix + "missedSet", String(candidate)),
          redis.sismember(prefix + "attendedSet", String(candidate)),
          redis.get(prefix + `ticketTime:${candidate}`),
        ]);
        if (!isCancelled && !isMissed && !isAttended && joinTs) {
          next = candidate;
          await redis.srem(prefix + "skippedSet", String(next));
          break;
      }
      await redis.srem(prefix + "prioritySet", String(candidate));
      p = await redis.lpop(prefix + "priorityQueue");
    }
    if (next === undefined) {
      if (priorityOnly) {
        return { statusCode: 404, body: "Sem tickets preferenciais" };
      }
      next = await redis.incr(counterKey);
    }
  } else {
    if (priorityOnly) {
      return { statusCode: 404, body: "Sem tickets preferenciais" };
    }
    next = await redis.incr(counterKey);
  }

    const ticketCount = Number(await redis.get(prefix + "ticketCounter") || 0);
    // Se automático, pular tickets cancelados, perdidos, pulados ou prioritários sem removê-los
    if (!paramNum && (!p || next !== Number(p))) {
      while (
        next <= ticketCount &&
        (
          (await redis.sismember(prefix + "cancelledSet", String(next))) ||
          (await redis.sismember(prefix + "missedSet", String(next))) ||
          (await redis.sismember(prefix + "skippedSet", String(next))) ||
          (!priorityOnly && (await redis.sismember(prefix + "prioritySet", String(next))))
        )
      ) {
        next = await redis.incr(counterKey);
      }
    }

    if (next > ticketCount || !(await redis.get(prefix + `ticketTime:${next}`))) {
      await redis.set(counterKey, prevCounter);
      return { statusCode: 404, body: "Sem tickets na fila" };
    }

    await redis.srem(prefix + "offHoursSet", String(next));

    // Quando a chamada é automática (Próximo), quem perde a vez é o último
    // número chamado nessa sequência (prevCounter), independente de haver
    // chamadas manuais entre eles. Assim tickets com ou sem nome são
    // tratados igualmente. Se o ticket anterior foi reordenado devido a
    // uma chamada preferencial, ignora esta etapa para evitar cancelamento
    // indevido.
    if (!paramNum && !priorityOnly && prevCounter && next > prevCounter) {
      const wasRequeued = await redis.sismember(requeuedPrevSetKey, String(prevCounter));
      if (wasRequeued) {
        await redis.srem(requeuedPrevSetKey, String(prevCounter));
      } else {
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
