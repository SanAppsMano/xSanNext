import { Redis } from "@upstash/redis";

export async function handler(event) {
  const url = new URL(event.rawUrl);
  const tenantId = url.searchParams.get("t");
  if (!tenantId) {
    return { statusCode: 400, body: "Missing tenantId" };
  }

  const redis = Redis.fromEnv();
  const prefix = `tenant:${tenantId}:`;

  const data = await Promise.all([
    redis.lrange(prefix + "log:entered", 0, -1),
    redis.lrange(prefix + "log:called", 0, -1),
    redis.lrange(prefix + "log:attended", 0, -1),
    redis.lrange(prefix + "log:cancelled", 0, -1),
    redis.get(prefix + "ticketCounter"),
    redis.smembers(prefix + "cancelledSet"),
    redis.smembers(prefix + "missedSet"),
    redis.smembers(prefix + "attendedSet"),
  ]);

  const [
    enteredRaw,
    calledRaw,
    attendedRaw,
    cancelledRaw,
    ticketCounterRaw,
    cancelledSet,
    missedSet,
    attendedSet,
  ] = data;

  const entered   = enteredRaw.map((s) => JSON.parse(s));
  const called    = calledRaw.map((s) => JSON.parse(s));
  const attended  = attendedRaw.map((s) => JSON.parse(s));
  const cancelled = cancelledRaw.map((s) => JSON.parse(s));

  const cancelledNums = cancelledSet.map((n) => Number(n));
  const missedNums    = missedSet.map((n) => Number(n));
  const attendedNums  = attendedSet.map((n) => Number(n));

  // Determina o maior número de ticket considerando logs e sets
  const maxFromLogs = Math.max(
    0,
    ...entered.map(e => e.ticket),
    ...called.map(c => c.ticket),
    ...attended.map(a => a.ticket),
    ...cancelled.map(c => c.ticket),
    ...cancelledNums,
    ...missedNums,
    ...attendedNums
  );
  const ticketCounter = Math.max(Number(ticketCounterRaw || 0), maxFromLogs);

  const map = {};
  for (let i = 1; i <= ticketCounter; i++) {
    map[i] = { ticket: i };
  }
  entered.forEach((e) => {
    map[e.ticket] = { ...(map[e.ticket] || { ticket: e.ticket }), entered: e.ts };
  });
  called.forEach(c => {
    map[c.ticket] = {
      ...(map[c.ticket] || { ticket: c.ticket }),
      called: c.ts,
      wait: c.wait,
    };
  });
  attended.forEach(a => {
    map[a.ticket] = {
      ...(map[a.ticket] || { ticket: a.ticket }),
      attended: a.ts,
      wait: a.wait,
      duration: a.duration,
    };
  });
  cancelled.forEach(c => {
    map[c.ticket] = {
      ...(map[c.ticket] || { ticket: c.ticket }),
      cancelled: c.ts,
      reason: c.reason,
      wait: c.wait,
      duration: c.duration,
    };
  });

  const tickets = Object.values(map).sort((a, b) => a.ticket - b.ticket);

  // Contabiliza quantidades de forma robusta combinando logs e sets
  const attendedTickets  = new Set([
    ...attendedNums,
    ...attended.map(a => a.ticket)
  ]);
  const cancelledTickets = new Set([
    ...cancelledNums,
    ...cancelled.filter(c => c.reason !== "missed").map(c => c.ticket)
  ]);
  const missedTickets    = new Set([
    ...missedNums,
    ...cancelled.filter(c => c.reason === "missed").map(c => c.ticket)
  ]);
  const attendedCount  = attendedTickets.size;
  const cancelledCount = cancelledTickets.size;
  const missedCount    = missedTickets.size;
  const waitValues = tickets.map((t) => t.wait).filter((n) => typeof n === "number");
  const durValues  = tickets.map((t) => t.duration).filter((n) => typeof n === "number");
  const totalWait  = waitValues.reduce((sum, v) => sum + v, 0);
  const totalDur   = durValues.reduce((sum, v) => sum + v, 0);
  const avgWait    = waitValues.length ? Math.round(totalWait / waitValues.length) : 0;
  const avgDur     = durValues.length ? Math.round(totalDur / durValues.length) : 0;

  return {
    statusCode: 200,
    body: JSON.stringify({
      tickets,
      summary: {
        totalTickets: ticketCounter,
        attendedCount,
        cancelledCount,
        missedCount,
        avgWait,
        avgDur,
      },
    }),
  };
}
