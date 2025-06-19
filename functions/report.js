import { Redis } from "@upstash/redis";

export async function handler(event) {
  const url = new URL(event.rawUrl);
  const tenantId = url.searchParams.get("t");
  if (!tenantId) {
    return { statusCode: 400, body: "Missing tenantId" };
  }

  const redis = Redis.fromEnv();
  const prefix = `tenant:${tenantId}:`;

  try {
    const [enRaw, caRaw, atRaw, cancelledSet, missedSet] = await Promise.all([
      redis.lrange(prefix + "log:entered", 0, 49),
      redis.lrange(prefix + "log:cancelled", 0, 49),
      redis.lrange(prefix + "log:attended", 0, 49),
      redis.smembers(prefix + "cancelledSet"),
      redis.smembers(prefix + "missedSet"),
    ]);

    const entered = enRaw.map(s => JSON.parse(s)).sort((a,b) => b.ts - a.ts);
    const cancelAll = caRaw.map(s => JSON.parse(s));
    const cancelledSetMap = new Set(cancelledSet);
    const missedSetMap    = new Set(missedSet);
    const cancelled = cancelAll
      .filter(r => r.reason !== "missed" && cancelledSetMap.has(String(r.ticket)))
      .sort((a,b) => b.ts - a.ts);
    const missed = cancelAll
      .filter(r => r.reason === "missed" && missedSetMap.has(String(r.ticket)))
      .sort((a,b) => b.ts - a.ts);
    const attended = atRaw.map(s => JSON.parse(s)).sort((a,b)=>b.ts - a.ts);

    return {
      statusCode: 200,
      body: JSON.stringify({ entered, cancelled, missed, attended }),
    };
  } catch (e) {
    console.error("report error", e);
    return { statusCode: 500, body: "Error" };
  }
}
