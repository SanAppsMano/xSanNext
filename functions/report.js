import { Redis } from "@upstash/redis";

export async function handler(event) {
  const url = new URL(event.rawUrl);
  const tenantId = url.searchParams.get("t");
  if (!tenantId) {
    return { statusCode: 400, body: "Missing tenantId" };
  }

  const redis = Redis.fromEnv();
  const prefix = `tenant:${tenantId}:`;

  const logs = await Promise.all([
    redis.lrange(prefix + "log:entered", 0, -1),
    redis.lrange(prefix + "log:called", 0, -1),
    redis.lrange(prefix + "log:attended", 0, -1),
    redis.lrange(prefix + "log:cancelled", 0, -1),
  ]);

  const [enteredRaw, calledRaw, attendedRaw, cancelledRaw] = logs;

  const entered   = enteredRaw.map(s => JSON.parse(s));
  const called    = calledRaw.map(s => JSON.parse(s));
  const attended  = attendedRaw.map(s => JSON.parse(s));
  const cancelled = cancelledRaw.map(s => JSON.parse(s));

  const map = {};
  entered.forEach(e => { map[e.ticket] = { ticket: e.ticket, entered: e.ts }; });
  called.forEach(c => {
    map[c.ticket] = { ...(map[c.ticket] || { ticket: c.ticket }), called: c.ts, wait: c.wait };
  });
  attended.forEach(a => {
    map[a.ticket] = { ...(map[a.ticket] || { ticket: a.ticket }), attended: a.ts, wait: a.wait, duration: a.duration };
  });
  cancelled.forEach(c => {
    map[c.ticket] = { ...(map[c.ticket] || { ticket: c.ticket }), cancelled: c.ts, reason: c.reason, wait: c.wait, duration: c.duration };
  });

  const tickets = Object.values(map).sort((a, b) => a.ticket - b.ticket);

  const attendedCount  = tickets.filter(t => t.attended).length;
  const cancelledCount = tickets.filter(t => t.cancelled && t.reason !== 'missed').length;
  const missedCount    = tickets.filter(t => t.reason === 'missed').length;
  const totalWait = tickets.reduce((sum, t) => sum + (t.wait || 0), 0);
  const totalDur  = tickets.reduce((sum, t) => sum + (t.duration || 0), 0);
  const avgWait   = attendedCount ? Math.round(totalWait / attendedCount) : 0;
  const avgDur    = attendedCount ? Math.round(totalDur / attendedCount) : 0;

  return {
    statusCode: 200,
    body: JSON.stringify({
      tickets,
      summary: {
        totalTickets: tickets.length,
        attendedCount,
        cancelledCount,
        missedCount,
        avgWait,
        avgDur,
      },
    }),
  };
}
