import { Redis } from "@upstash/redis";

export async function handler(event) {
  const url      = new URL(event.rawUrl);
  const tenantId = url.searchParams.get("t");
  if (!tenantId) {
    return { statusCode: 400, body: "Missing tenantId" };
  }

  const redis  = Redis.fromEnv();
  const prefix = `tenant:${tenantId}:`;

  const [currentCallRaw, callCounterRaw, ticketCounterRaw, attendantRaw, timestampRaw] =
    await redis.mget(
      prefix + "currentCall",
      prefix + "callCounter",
      prefix + "ticketCounter",
      prefix + "currentAttendant",
      prefix + "currentCallTs"
    );
  const currentCall   = Number(currentCallRaw || 0);
  const callCounter   = Number(callCounterRaw || 0);
  const ticketCounter = Number(ticketCounterRaw || 0);
  const attendant     = attendantRaw || "";
  const timestamp     = Number(timestampRaw || 0);
  const [cancelledSet, missedSet, attendedSet, nameMap] = await Promise.all([
    redis.smembers(prefix + "cancelledSet"),
    redis.smembers(prefix + "missedSet"),
    redis.smembers(prefix + "attendedSet"),
    redis.hgetall(prefix + "ticketNames")
  ]);
  const cancelledNums = cancelledSet.map(n => Number(n)).sort((a, b) => a - b);
  const missedNums    = missedSet.map(n => Number(n)).sort((a, b) => a - b);
  const attendedNums  = attendedSet.map(n => Number(n)).sort((a, b) => a - b);
  const cancelledCount= cancelledNums.length;
  const missedCount   = missedNums.length;
  const attendedCount = attendedNums.length;
  const waiting       = Math.max(0, ticketCounter - cancelledCount - missedCount - attendedCount);

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
      names: nameMap || {},
    }),
  };
}
