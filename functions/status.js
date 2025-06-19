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
  const currentName   = await redis.get(prefix + `name:${currentCall}`);
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

  const nameKeys = [];
  for (let i = 1; i <= ticketCounter; i++) nameKeys.push(prefix + `name:${i}`);
  const nameVals = await redis.mget(...nameKeys);
  const names = {};
  nameVals.forEach((v, idx) => { if (v) names[idx + 1] = v; });

  return {
    statusCode: 200,
    body: JSON.stringify({
      currentCall,
      currentName,
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
      names,
    }),
  };
}
