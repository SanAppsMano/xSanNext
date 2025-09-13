import { Redis } from "@upstash/redis";
import { error, json } from "./utils/response.js";

export async function handler(event) {
  const url      = new URL(event.rawUrl);
  const tenantId = url.searchParams.get("t");
  if (!tenantId) {
    return error(400, "tenantId ausente");
  }

  const redis  = Redis.fromEnv();
  const [pwHash, monitor] = await redis.mget(
    `tenant:${tenantId}:pwHash`,
    `monitor:${tenantId}`
  );
  if (!pwHash && !monitor) {
    return error(404, "Link inválido");
  }
  const prefix = `tenant:${tenantId}:`;

  // Últimos 50 cancelamentos e tickets cancelados atualmente
  const [raw, cancelledArr, missedArr] = await Promise.all([
    redis.lrange(prefix + "log:cancelled", 0, 49),
    redis.smembers(prefix + "cancelledSet"),
    redis.smembers(prefix + "missedSet")
  ]);
  const all = raw.map(s => JSON.parse(s));
  const cancelledSet = new Set(cancelledArr);
  const missedSet    = new Set(missedArr);
  const cancelled = all
    .filter(r => r.reason !== "missed" && cancelledSet.has(String(r.ticket)))
    .sort((a, b) => b.ts - a.ts);
  const missed = all
    .filter(r => r.reason === "missed" && missedSet.has(String(r.ticket)))
    .sort((a, b) => b.ts - a.ts);
  const nums = Array.from(cancelledSet).map(n => Number(n));
  const missedNums = Array.from(missedSet).map(n => Number(n));

  return json(200, {
    cancelled,
    numbers: nums,
    count: nums.length,
    missed,
    missedNumbers: missedNums,
    missedCount: missedNums.length,
  });
}
