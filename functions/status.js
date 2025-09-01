// SAFE REFACTOR: reverted broken HMGET to MGET for existing keys (read-only).
// Do not change write/queue operations. Do not change API shapes.
import { Redis } from "@upstash/redis";

export async function handler(event) {
  const url      = new URL(event.rawUrl);
  const tenantId = url.searchParams.get("t");
  if (!tenantId) {
    return { statusCode: 400, body: "Missing tenantId" };
  }

  const redis  = Redis.fromEnv();
  const [pwHash, monitorRaw, schedRaw] = await redis.mget(
    `tenant:${tenantId}:pwHash`,
    `monitor:${tenantId}`,
    `tenant:${tenantId}:schedule`
  );
  if (!pwHash && !monitorRaw) {
    return { statusCode: 404, body: "Invalid link" };
  }
  const prefix = `tenant:${tenantId}:`;

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

  const ticketParam = url.searchParams.get("tk");
  if (ticketParam) {
    const tNum = Number(ticketParam);
    if (await redis.sismember(prefix + "offHoursSet", String(tNum)) && withinSchedule(schedule)) {
      await redis.srem(prefix + "offHoursSet", String(tNum));
    }
  }

  const [currentCallRaw, callCounterRaw, ticketCounterRaw, attendantRaw, timestampRaw, logoutVersionRaw] =
    await redis.mget(
      prefix + "currentCall",
      prefix + "callCounter",
      prefix + "ticketCounter",
      prefix + "currentAttendant",
      prefix + "currentCallTs",
      prefix + "logoutVersion"
    );
  const currentCall   = Number(currentCallRaw || 0);
  const callCounter   = Number(callCounterRaw || 0);
  const ticketCounter = Number(ticketCounterRaw || 0);
  const attendant     = attendantRaw || "";
  const timestamp     = Number(timestampRaw || 0);
  const [cancelledList, missedList, attendedList, skippedList, offHoursList, nameMap] = await Promise.all([
    redis.smembers(prefix + "cancelledSet"),
    redis.smembers(prefix + "missedSet"),
    redis.smembers(prefix + "attendedSet"),
    redis.smembers(prefix + "skippedSet"),
    redis.smembers(prefix + "offHoursSet"),
    redis.hgetall(prefix + "ticketNames")
  ]);

  let offHoursNums = offHoursList.map(n => Number(n)).sort((a, b) => a - b);
  if (offHoursNums.length && withinSchedule(schedule)) {
    await redis.srem(prefix + "offHoursSet", ...offHoursList);
    offHoursNums = [];
  }

  const cancelledNums = cancelledList.map(n => Number(n)).sort((a, b) => a - b);
  const missedNums    = missedList.map(n => Number(n)).sort((a, b) => a - b);
  const attendedNums  = attendedList.map(n => Number(n)).sort((a, b) => a - b);

  // Remove números pulados que correspondem a tickets reais
  let skippedNums     = skippedList.map(n => Number(n)).sort((a, b) => a - b);
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

  const cancelledCount = cancelledNums.length;
  const missedCount    = missedNums.length;
  const attendedCount  = attendedNums.length;
  const offHoursCount  = offHoursNums.length;
  const cancelledSet = new Set(cancelledNums);
  const missedSet    = new Set(missedNums);
  const attendedSet  = new Set(attendedNums);
  const skippedSet   = new Set(skippedNums);
  const offHoursSet  = new Set(offHoursNums);

  let waiting = 0;
  for (let i = callCounter + 1; i <= ticketCounter; i++) {
    if (
      !cancelledSet.has(i) &&
      !missedSet.has(i) &&
      !attendedSet.has(i) &&
      !skippedSet.has(i) &&
      !offHoursSet.has(i)
    ) {
      waiting++;
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      currentCall,
      callCounter,
      ticketCounter,
      attendant,
      timestamp,
      cancelledCount,
      cancelledNumbers: cancelledNums,
      missedNumbers: missedNums,
      missedCount,
      attendedNumbers: attendedNums,
      attendedCount,
      skippedNumbers: skippedNums,
      offHoursNumbers: offHoursNums,
      offHoursCount,
      waiting,
      names: nameMap || {},
      logoutVersion: Number(logoutVersionRaw || 0),
    }),
  };
}
