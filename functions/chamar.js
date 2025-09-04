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
    const currentPriorityPrev = Number(
      (await redis.get(prefix + "currentCallPriority")) || 0
    );
    const isRepeatingPriority =
      paramNum !== null && Number(paramNum) === currentCallPrev;
    let p = null;
    if (!paramNum && priorityOnly) {
      p = await redis.lpop(prefix + "priorityQueue");
      if (!p) {
        if (currentPriorityPrev === 1 && currentCallPrev) {
          const [isCancelled, isMissed, isAttended, isSkipped, joinPrev] =
            await Promise.all([
              redis.sismember(prefix + "cancelledSet", String(currentCallPrev)),
              redis.sismember(prefix + "missedSet", String(currentCallPrev)),
              redis.sismember(prefix + "attendedSet", String(currentCallPrev)),
              redis.sismember(prefix + "skippedSet", String(currentCallPrev)),
              redis.get(prefix + `ticketTime:${currentCallPrev}`),
            ]);
          if (!isCancelled && !isMissed && !isAttended && !isSkipped && joinPrev) {
            const calledTs = Number(
              (await redis.get(prefix + `calledTime:${currentCallPrev}`)) || 0
            );
            const dur = calledTs ? Date.now() - calledTs : 0;
            const waitPrev = Number(
              (await redis.get(prefix + `wait:${currentCallPrev}`)) || 0
            );
            await redis.sadd(prefix + "missedSet", String(currentCallPrev));
            const missTs = Date.now();
            await redis.set(prefix + `cancelledTime:${currentCallPrev}`, missTs);
            await redis.lpush(
              prefix + "log:cancelled",
              JSON.stringify({
                ticket: currentCallPrev,
                ts: missTs,
                reason: "missed",
                duration: dur,
                wait: waitPrev,
              })
            );
            await redis.ltrim(prefix + "log:cancelled", 0, 999);
            await redis.expire(prefix + "log:cancelled", LOG_TTL);
            await redis.del(prefix + `wait:${currentCallPrev}`);
          }
          await redis.mset({
            [prefix + "currentCall"]: 0,
            [prefix + "currentCallTs"]: 0,
            [prefix + "currentCallPriority"]: 0,
          });
          await redis.del(prefix + "currentAttendant");
        }
        return { statusCode: 404, body: "Sem tickets na fila" };
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
    const prevCounter = Number((await redis.get(counterKey)) || 0);

    // Se outro preferencial for chamado enquanto um preferencial está em atendimento,
    // o atual perde a vez, exceto quando for uma repetição do mesmo ticket
    if (
      isPriorityCall &&
      currentPriorityPrev === 1 &&
      currentCallPrev &&
      !isRepeatingPriority
    ) {
      const [isCancelled, isMissed, isAttended, isSkipped, joinPrev] =
        await Promise.all([
          redis.sismember(prefix + "cancelledSet", String(currentCallPrev)),
          redis.sismember(prefix + "missedSet", String(currentCallPrev)),
          redis.sismember(prefix + "attendedSet", String(currentCallPrev)),
          redis.sismember(prefix + "skippedSet", String(currentCallPrev)),
          redis.get(prefix + `ticketTime:${currentCallPrev}`),
        ]);
      if (!isCancelled && !isMissed && !isAttended && !isSkipped && joinPrev) {
        const calledTs = Number(
          (await redis.get(prefix + `calledTime:${currentCallPrev}`)) || 0
        );
        const dur = calledTs ? Date.now() - calledTs : 0;
        const waitPrev = Number(
          (await redis.get(prefix + `wait:${currentCallPrev}`)) || 0
        );
        await redis.sadd(prefix + "missedSet", String(currentCallPrev));
        const missTs = Date.now();
        await redis.set(prefix + `cancelledTime:${currentCallPrev}`, missTs);
        await redis.lpush(
          prefix + "log:cancelled",
          JSON.stringify({
            ticket: currentCallPrev,
            ts: missTs,
            reason: "missed",
            duration: dur,
            wait: waitPrev,
          })
        );
        await redis.ltrim(prefix + "log:cancelled", 0, 999);
        await redis.expire(prefix + "log:cancelled", LOG_TTL);
        await redis.del(prefix + `wait:${currentCallPrev}`);
      }
    }

    // Em chamadas preferenciais, mantém o ticket atual na fila normal
    if (isPriorityCall && prevCounter === currentCallPrev && prevCounter > 0) {
      const [isCancelled, isMissed, isAttended, isSkipped, joinPrev] =
        await Promise.all([
          redis.sismember(prefix + "cancelledSet", String(currentCallPrev)),
          redis.sismember(prefix + "missedSet", String(currentCallPrev)),
          redis.sismember(prefix + "attendedSet", String(currentCallPrev)),
          redis.sismember(prefix + "skippedSet", String(currentCallPrev)),
          redis.get(prefix + `ticketTime:${currentCallPrev}`),
        ]);
      if (!isCancelled && !isMissed && !isAttended && !isSkipped && joinPrev) {
        await redis.decr(counterKey);
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
      if (isPriorityCall) {
        await redis.lrem(prefix + "priorityQueue", 0, String(next));
      }
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
        next = prevCounter + 1;
      }
    } else {
      if (priorityOnly) {
        return { statusCode: 404, body: "Sem tickets preferenciais" };
      }
      next = prevCounter + 1;
    }

    const ticketCount = Number((await redis.get(prefix + "ticketCounter")) || 0);
    // Se automático, pular tickets cancelados, perdidos, atendidos, pulados ou prioritários sem removê-los
    if (!paramNum && (!p || next !== Number(p))) {
      while (
        next <= ticketCount &&
        (
          (await redis.sismember(prefix + "cancelledSet", String(next))) ||
          (await redis.sismember(prefix + "missedSet", String(next))) ||
          (await redis.sismember(prefix + "attendedSet", String(next))) ||
          (await redis.sismember(prefix + "skippedSet", String(next))) ||
          (!priorityOnly && (await redis.sismember(prefix + "prioritySet", String(next))))
        )
      ) {
        next++;
      }
    }

    if (next > ticketCount || !(await redis.get(prefix + `ticketTime:${next}`))) {
      // só altera o ticket atual quando a chamada pertence à mesma fila
      if (
        currentCallPrev &&
        ((isPriorityCall && currentPriorityPrev === 1) ||
          (!isPriorityCall && currentPriorityPrev === 0))
      ) {
        const [isCancelled, isMissed, isAttended, isSkipped, joinPrev] =
          await Promise.all([
            redis.sismember(prefix + "cancelledSet", String(currentCallPrev)),
            redis.sismember(prefix + "missedSet", String(currentCallPrev)),
            redis.sismember(prefix + "attendedSet", String(currentCallPrev)),
            redis.sismember(prefix + "skippedSet", String(currentCallPrev)),
            redis.get(prefix + `ticketTime:${currentCallPrev}`),
          ]);
        if (!isCancelled && !isMissed && !isAttended && !isSkipped && joinPrev) {
          const calledTs = Number(
            (await redis.get(prefix + `calledTime:${currentCallPrev}`)) || 0
          );
          const dur = calledTs ? Date.now() - calledTs : 0;
          const waitPrev = Number(
            (await redis.get(prefix + `wait:${currentCallPrev}`)) || 0
          );
          await redis.sadd(prefix + "missedSet", String(currentCallPrev));
          const missTs = Date.now();
          await redis.set(prefix + `cancelledTime:${currentCallPrev}`, missTs);
          await redis.lpush(
            prefix + "log:cancelled",
            JSON.stringify({
              ticket: currentCallPrev,
              ts: missTs,
              reason: "missed",
              duration: dur,
              wait: waitPrev,
            })
          );
          await redis.ltrim(prefix + "log:cancelled", 0, 999);
          await redis.expire(prefix + "log:cancelled", LOG_TTL);
          await redis.del(prefix + `wait:${currentCallPrev}`);
        }
        await redis.mset({
          [prefix + "currentCall"]: 0,
          [prefix + "currentCallTs"]: 0,
          [prefix + "currentCallPriority"]: 0,
        });
        await redis.del(prefix + "currentAttendant");
      }
      await redis.set(counterKey, prevCounter);
      return { statusCode: 404, body: "Sem tickets na fila" };
    }

    if (!paramNum && (!p || next !== Number(p))) {
      await redis.set(counterKey, next);
    }

    await redis.srem(prefix + "offHoursSet", String(next));

    // Quando a chamada é automática (Próximo), quem perde a vez é o último
    // número chamado nessa sequência (prevCounter), independente de haver
    // chamadas manuais entre eles. Assim tickets com ou sem nome são
    // tratados igualmente.
    if (!paramNum && !isPriorityCall && currentPriorityPrev === 0 && prevCounter && next > prevCounter) {
      // Evita interferência entre filas: não marca preferenciais como "perdeu a vez"
      const isPrevPriority = await redis.sismember(prefix + "prioritySet", String(prevCounter));
      if (!isPrevPriority) {
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
      [prefix + "currentCallPriority"]: isPriorityCall ? 1 : 0,
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
