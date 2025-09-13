import { Redis } from "@upstash/redis";
import { error, json } from "./utils/response.js";

const LOG_TTL = 60 * 60 * 24 * 30; // 30 days

export async function handler(event) {
  const url      = new URL(event.rawUrl);
  const tenantId = url.searchParams.get("t");
  if (!tenantId) {
    return error(400, "Missing tenantId");
  }

  const redis  = Redis.fromEnv();
  const [pwHash, monitor] = await redis.mget(
    `tenant:${tenantId}:pwHash`,
    `monitor:${tenantId}`
  );
  if (!pwHash && !monitor) {
    return error(404, "Invalid link");
  }
  const prefix = `tenant:${tenantId}:`;
  const { clientId, ticket, reason = "client", duration } = JSON.parse(event.body || "{}");

  // Recupera o número do ticket via clientId ou usa o fornecido diretamente
  let ticketNum;
  if (ticket !== undefined && ticket !== null) {
    ticketNum = String(ticket);
  } else {
    ticketNum = await redis.get(prefix + `ticket:${clientId}`);
    await redis.del(prefix + `ticket:${clientId}`);
  }
  if (ticketNum) {
    await redis.srem(prefix + "offHoursSet", ticketNum);
    await redis.lrem(prefix + "priorityQueue", 0, ticketNum);
    await redis.srem(prefix + "prioritySet", ticketNum);
  }

  let wait = 0;
  if (ticketNum) {
    const joinTs = await redis.get(prefix + `ticketTime:${ticketNum}`);
    if (joinTs) {
      wait = Date.now() - Number(joinTs);
      // mantém ticketTime para referência futura
    }
  }

  const attended = ticketNum
    ? await redis.sismember(prefix + "attendedSet", ticketNum)
    : false;

  // Se havia ticket e não foi atendido, marca cancelamento
  if (ticketNum && !attended) {
    if (reason === "missed") {
      await redis.sadd(prefix + "missedSet", ticketNum);
    } else {
      await redis.sadd(prefix + "cancelledSet", ticketNum);
    }
    // registro do cancelamento com timestamp
    const ts = Date.now();
    const calledTs = Number((await redis.get(prefix + `calledTime:${ticketNum}`)) || 0);
    const dur = calledTs ? Date.now() - calledTs : duration ? Number(duration) : 0;
    await redis.set(prefix + `cancelledTime:${ticketNum}`, ts);
    await redis.lpush(
      prefix + "log:cancelled",
      JSON.stringify({ ticket: Number(ticketNum), ts, reason, duration: dur, wait })
    );
    await redis.ltrim(prefix + "log:cancelled", 0, 999);
    await redis.expire(prefix + "log:cancelled", LOG_TTL);
    await redis.del(prefix + `wait:${ticketNum}`);

    // Se o ticket cancelado era o atual, limpa a chamada
    const currentCall = Number((await redis.get(prefix + "currentCall")) || 0);
    if (currentCall === Number(ticketNum)) {
      await redis.mset({
        [prefix + "currentCall"]: 0,
        [prefix + "currentCallTs"]: 0,
        [prefix + "currentCallPriority"]: 0,
      });
      await redis.del(prefix + "currentAttendant");
    }

    return json(200, { cancelled: true, ticket: Number(ticketNum), ts, reason, duration: dur, wait });
  }

  // Se já havia sido atendido, apenas confirme
  if (ticketNum && attended) {
    return json(200, { alreadyAttended: true, ticket: Number(ticketNum) });
  }

  // Nada a cancelar
  return json(200, { cancelled: false });
}
