import { Redis } from "@upstash/redis";

export async function handler(event) {
  const url      = new URL(event.rawUrl);
  const tenantId = url.searchParams.get("t");
  if (!tenantId) {
    return { statusCode: 400, body: "Missing tenantId" };
  }

  const redis  = Redis.fromEnv();
  const prefix = `tenant:${tenantId}:`;

  const currentCall   = Number(await redis.get(prefix + "currentCall")   || 0);
  const callCounter   = Number(await redis.get(prefix + "callCounter")    || 0);
  const ticketCounter = Number(await redis.get(prefix + "ticketCounter") || 0);
  const attendant     = (await redis.get(prefix + "currentAttendant")) || "";
  const timestamp     = Number(await redis.get(prefix + "currentCallTs")  || 0);
  const [cancelledSet, missedSet, attendedSet] = await Promise.all([
    redis.smembers(prefix + "cancelledSet"),
    redis.smembers(prefix + "missedSet"),
    redis.smembers(prefix + "attendedSet")
  ]);
  const cancelledNums = cancelledSet.map(n => Number(n)).sort((a, b) => a - b);
  const missedNums    = missedSet.map(n => Number(n)).sort((a, b) => a - b);
  const attendedNums  = attendedSet.map(n => Number(n)).sort((a, b) => a - b);
  const cancelledCount= cancelledNums.length;
  const missedCount   = missedNums.length;
  const attendedCount = attendedNums.length;
  const waiting       = Math.max(0, ticketCounter - cancelledCount - missedCount - attendedCount);

  // Mapear nomes para tickets ativos
  const activeTickets = [];
  for (let i = 1; i <= ticketCounter; i++) {
    if (!cancelledNums.includes(i) && !missedNums.includes(i) && !attendedNums.includes(i)) {
      activeTickets.push(i);
    }
  }
  const names = {};
  for (const n of activeTickets) {
    const name = await redis.get(prefix + `ticketName:${n}`);
    if (name) names[n] = name;
  }
  const currentName = await redis.get(prefix + `ticketName:${currentCall}`);

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
      waiting,
      currentName,
      names,
    }),
  };
}
