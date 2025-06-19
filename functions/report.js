import { Redis } from "@upstash/redis";

export async function handler(event) {
  const url = new URL(event.rawUrl);
  const tenantId = url.searchParams.get("t");
  if (!tenantId) {
    return { statusCode: 400, body: "Missing tenantId" };
  }

  const redis = Redis.fromEnv();
  const prefix = `tenant:${tenantId}:`;

  // Verifica se o token/tenant existe
  const exists = await redis.exists(prefix + "ticketCounter");
  if (!exists) {
    return { statusCode: 404, body: "Invalid tenant" };
  }

  const data = await Promise.all([
    redis.lrange(prefix + "log:entered", 0, -1),
    redis.lrange(prefix + "log:called", 0, -1),
    redis.lrange(prefix + "log:attended", 0, -1),
    redis.lrange(prefix + "log:cancelled", 0, -1),
    redis.get(prefix + "ticketCounter"),
    redis.smembers(prefix + "cancelledSet"),
    redis.smembers(prefix + "missedSet"),
    redis.smembers(prefix + "attendedSet"),
    redis.hgetall(prefix + "ticketNames")
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
    nameMap
  ] = data;

  const safeParse = (val) => {
    if (typeof val !== "string") return null;
    try {
      return JSON.parse(val);
    } catch {
      return null;
    }
  };

  const entered   = enteredRaw.map(safeParse).filter(Boolean);
  const called    = calledRaw.map(safeParse).filter(Boolean);
  const attended  = attendedRaw.map(safeParse).filter(Boolean);
  const cancelled = cancelledRaw.map(safeParse).filter(Boolean);

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

  if (nameMap) {
    Object.entries(nameMap).forEach(([num, n]) => {
      const id = Number(num);
      map[id] = { ...(map[id] || { ticket: id }), name: n };
    });
  }

  // Busca timestamps individuais utilizando mget para evitar muitos acessos
  async function loadTimes(prefixKey) {
    const keys = [];
    for (let i = 1; i <= ticketCounter; i++) {
      keys.push(prefix + `${prefixKey}:${i}`);
    }
    const values = await redis.mget(...keys);
    const result = {};
    values.forEach((val, idx) => {
      if (val !== null && val !== undefined) {
        result[idx + 1] = Number(val);
      }
    });
    return result;
  }
  const [enteredTimes, calledTimes, attendedTimes, cancelledTimes] = await Promise.all([
    loadTimes('ticketTime'),
    loadTimes('calledTime'),
    loadTimes('attendedTime'),
    loadTimes('cancelledTime'),
  ]);
  entered.forEach((e) => {
    map[e.ticket] = { ...(map[e.ticket] || { ticket: e.ticket }), entered: e.ts };
  });
  called.forEach(c => {
    map[c.ticket] = {
      ...(map[c.ticket] || { ticket: c.ticket }),
      called: c.ts,
    };
  });
  attended.forEach(a => {
    map[a.ticket] = {
      ...(map[a.ticket] || { ticket: a.ticket }),
      attended: a.ts,
    };
  });
  cancelled.forEach(c => {
    map[c.ticket] = {
      ...(map[c.ticket] || { ticket: c.ticket }),
      cancelled: c.ts,
      reason: c.reason,
    };
  });

  // Preenche dados faltantes com valores individuais
  for (let i = 1; i <= ticketCounter; i++) {
    const tk = map[i];
    if (!tk.entered && enteredTimes[i]) tk.entered = enteredTimes[i];
    if (!tk.called && calledTimes[i]) tk.called = calledTimes[i];
    if (!tk.attended && attendedTimes[i]) tk.attended = attendedTimes[i];
    if (!tk.cancelled && cancelledTimes[i]) tk.cancelled = cancelledTimes[i];
  }

  const tickets = Object.values(map).sort((a, b) => a.ticket - b.ticket);
  // Helper para exibir datas no formato brasileiro
  const format = (ts) => ts ? new Date(ts).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : null;
  const toHms = (ms) => {
    if (!ms) return null;
    const s = Math.floor(ms / 1000);
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    return `${h}:${m}:${sec}`;
  };

  // Status e cálculos de tempo atuais
  const now = Date.now();
  tickets.forEach(tk => {
    if (attendedNums.includes(tk.ticket)) {
      tk.status = "attended";
    } else if (cancelledNums.includes(tk.ticket) && tk.reason !== "missed") {
      tk.status = "cancelled";
    } else if (missedNums.includes(tk.ticket) || tk.reason === "missed") {
      tk.status = "missed";
    } else if (tk.called) {
      tk.status = "called";
    } else {
      tk.status = "waiting";
    }

    if (tk.called && tk.entered) {
      tk.wait = tk.called - tk.entered;
    } else if (tk.cancelled && tk.entered && !tk.called) {
      tk.wait = tk.cancelled - tk.entered;
    } else if (tk.status === "waiting" && tk.entered) {
      tk.wait = now - tk.entered;
    }

    if (tk.attended && tk.called) {
      tk.duration = tk.attended - tk.called;
    } else if (tk.status === "called" && tk.called) {
      tk.duration = now - tk.called;
    }

    tk.enteredBr = format(tk.entered);
    tk.calledBr = format(tk.called);
    tk.attendedBr = format(tk.attended);
    tk.cancelledBr = format(tk.cancelled);
    if (tk.wait) tk.waitHms = toHms(tk.wait);
    if (tk.duration) tk.durationHms = toHms(tk.duration);
  });

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
  const waitingCount   = tickets.filter(t => t.status === "waiting").length;
  const waitValues = tickets.map((t) => t.wait).filter((n) => typeof n === "number");
  const durValues  = tickets.map((t) => t.duration).filter((n) => typeof n === "number");
  const totalWait  = waitValues.reduce((sum, v) => sum + v, 0);
  const totalDur   = durValues.reduce((sum, v) => sum + v, 0);
  const avgWait    = waitValues.length ? Math.round(totalWait / waitValues.length) : 0;
  const avgDur     = durValues.length ? Math.round(totalDur / durValues.length) : 0;
  const avgWaitHms = toHms(avgWait);
  const avgDurHms  = toHms(avgDur);

  return {
    statusCode: 200,
    body: JSON.stringify({
      tickets,
      summary: {
        totalTickets: ticketCounter,
        attendedCount,
        cancelledCount,
        missedCount,
        waitingCount,
        avgWait,
        avgDur,
        avgWaitHms,
        avgDurHms,
      },
    }),
  };
}
