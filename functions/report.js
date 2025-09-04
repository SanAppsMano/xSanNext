import { Redis } from "@upstash/redis";
import errorHandler from "./utils/errorHandler.js";

export async function handler(event) {
  try {
    const url = new URL(event.rawUrl);
    const tenantId = url.searchParams.get("t");
    if (!tenantId) {
      return { statusCode: 400, body: "Missing tenantId" };
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

    const data = await Promise.all([
      redis.lrange(prefix + "log:entered", 0, -1),
      redis.lrange(prefix + "log:called", 0, -1),
      redis.lrange(prefix + "log:attended", 0, -1),
      redis.lrange(prefix + "log:cancelled", 0, -1),
      redis.smembers(prefix + "cancelledSet"),
      redis.smembers(prefix + "missedSet"),
      redis.smembers(prefix + "attendedSet"),
      redis.hgetall(prefix + "ticketNames"),
      redis.smembers(prefix + "offHoursSet"),
      redis.smembers(prefix + "skippedSet"),
      redis.smembers(prefix + "priorityHistory"),
      redis.get(prefix + "ticketCounter"),
    ]);

    const [
      enteredRaw,
      calledRaw,
      attendedRaw,
      cancelledRaw,
      cancelledSet,
      missedSet,
      attendedSet,
      nameMap,
      offHoursSet,
      skippedList,
      priorityHistory,
      ticketCounterRaw,
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

  const cancelledNums = cancelledSet.map(n => Number(n));
  const missedNums    = missedSet.map(n => Number(n));
  const attendedNums  = attendedSet.map(n => Number(n));
  let offHoursNums    = offHoursSet.map(n => Number(n));
  let skippedNums     = skippedList.map(n => Number(n));

  if (skippedNums.length) {
    const keys   = skippedNums.map(n => prefix + `ticketTime:${n}`);
    const exists = await redis.mget(...keys);
    const toKeep = [];
    const toRem  = [];
    skippedNums.forEach((n, i) => {
      if (exists[i]) toRem.push(String(n));
      else           toKeep.push(n);
    });
    if (toRem.length) await redis.srem(prefix + "skippedSet", ...toRem);
    skippedNums = toKeep;
  }
  const skippedSet = new Set(skippedNums);
  if (offHoursSet.length) {
    const [schedRaw, monitorRaw] = await redis.mget(
      prefix + "schedule",
      `monitor:${tenantId}`
    );
    let schedule = null;
    if (schedRaw) {
      try { schedule = typeof schedRaw === "string" ? JSON.parse(schedRaw) : schedRaw; } catch {}
    } else if (monitorRaw) {
      try { schedule = JSON.parse(monitorRaw).schedule || null; } catch {}
    }
    const withinSchedule = (sched) => {
      if (!sched) return true;
      const tz   = sched.tz || "America/Sao_Paulo";
      const now  = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
      const day  = now.getDay();
      const days = (sched.days || []).map(Number);
      if (!days.includes(day)) return false;
      if (!sched.intervals || sched.intervals.length === 0) return true;
      const mins = now.getHours() * 60 + now.getMinutes();
      const toMins = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
      return sched.intervals.some(({ start, end }) => start && end && mins >= toMins(start) && mins < toMins(end));
    };
    if (withinSchedule(schedule)) {
      await redis.srem(prefix + "offHoursSet", ...offHoursSet);
      offHoursSet = [];
      offHoursNums = [];
    }
  }

  const ticketCounter = Number(ticketCounterRaw || 0);

  const ticketNumbers = new Set([
    ...entered.map(e => e.ticket),
    ...called.map(c => c.ticket),
    ...attended.map(a => a.ticket),
    ...cancelled.map(c => c.ticket),
    ...cancelledNums,
    ...missedNums,
    ...attendedNums,
    ...(nameMap ? Object.keys(nameMap).map(Number) : []),
    ...offHoursNums,
    ...priorityHistory.map(n => Number(n))
  ]);

  // remove números pulados e evita que entrem no total
  skippedNums.forEach(n => ticketNumbers.delete(n));

  for (let i = 1; i <= ticketCounter; i++) {
    if (!skippedSet.has(i)) {
      ticketNumbers.add(i);
    }
  }

  const nums = Array.from(ticketNumbers).sort((a, b) => a - b);

  const priorityNums = priorityHistory.map(n => Number(n));
  const priorityHistSet = new Set(priorityNums);

  const map = {};
  nums.forEach((n) => {
    map[n] = { ticket: n };
  });

  if (nameMap) {
    Object.entries(nameMap).forEach(([num, n]) => {
      const id = Number(num);
      map[id] = { ...(map[id] || { ticket: id }), name: n };
    });
  }

  // Busca timestamps individuais utilizando mget para evitar muitos acessos
  async function loadTimes(prefixKey) {
    if (!nums.length) return {};
    const keys = nums.map((i) => prefix + `${prefixKey}:${i}`);
    const values = await redis.mget(...keys);
    const result = {};
    values.forEach((val, idx) => {
      if (val !== null && val !== undefined) {
        result[nums[idx]] = Number(val);
      }
    });
    return result;
  }
  async function loadStrings(prefixKey) {
    if (!nums.length) return {};
    const keys = nums.map((i) => prefix + `${prefixKey}:${i}`);
    const values = await redis.mget(...keys);
    const result = {};
    values.forEach((val, idx) => {
      if (val !== null && val !== undefined) {
        result[nums[idx]] = String(val);
      }
    });
    return result;
  }
  const [enteredTimes, calledTimes, attendedTimes, cancelledTimes, identifiers] = await Promise.all([
    loadTimes('ticketTime'),
    loadTimes('calledTime'),
    loadTimes('attendedTime'),
    loadTimes('cancelledTime'),
    loadStrings('identifier'),
  ]);
  entered.forEach((e) => {
    map[e.ticket] = { ...(map[e.ticket] || { ticket: e.ticket }), entered: e.ts };
  });
  // Processa chamadas em ordem cronológica para preservar o primeiro identificador
  called.slice().reverse().forEach(c => {
    const prev = map[c.ticket] || { ticket: c.ticket };
    map[c.ticket] = {
      ...prev,
      called: c.ts,
      attendant: c.attendant || prev.attendant,
      // mantém identificador previamente definido quando chamadas posteriores não informam
      identifier: c.identifier || c.attendant || prev.identifier,
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
  nums.forEach((i) => {
    const tk = map[i];
    if (!tk.entered && enteredTimes[i]) tk.entered = enteredTimes[i];
    if (!tk.called && calledTimes[i]) tk.called = calledTimes[i];
    if (!tk.attended && attendedTimes[i]) tk.attended = attendedTimes[i];
    if (!tk.cancelled && cancelledTimes[i]) tk.cancelled = cancelledTimes[i];
    if (!tk.identifier && identifiers[i]) tk.identifier = identifiers[i];
  });

    const tickets = nums.map((n) => map[n]);
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
      tk.type = priorityHistSet.has(tk.ticket) ? 'Preferencial' : 'Normal';
      if (offHoursNums.includes(tk.ticket)) {
        tk.status = "offhours";
      } else if (attendedNums.includes(tk.ticket)) {
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

    const counts = { waiting: 0, called: 0, attended: 0, cancelled: 0, missed: 0, offhours: 0 };
    tickets.forEach(t => {
      if (counts[t.status] !== undefined) counts[t.status] += 1;
    });
    const attendedCount  = counts.attended;
    const cancelledCount = counts.cancelled;
    const missedCount    = counts.missed;
    const waitingCount   = counts.waiting;
    const calledCount    = counts.called;
    const offHoursCount  = counts.offhours;
    const totalTickets   = attendedCount + cancelledCount + missedCount + waitingCount + calledCount + offHoursCount;
    const priorityCount  = tickets.filter(t => t.type === 'Preferencial').length;
    const normalCount    = totalTickets - priorityCount;

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
          totalTickets,
          attendedCount,
          cancelledCount,
          missedCount,
          calledCount,
          waitingCount,
          offHoursCount,
          avgWait,
          avgDur,
          avgWaitHms,
          avgDurHms,
          priorityCount,
          normalCount,
        },
      }),
    };
  } catch (error) {
    return errorHandler(error);
  }
}
