import { Redis } from "@upstash/redis";
import errorHandler from "./utils/errorHandler.js";
import { error, json } from "./utils/response.js";

export async function handler(event) {
  try {
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

    const [raw, attendedSet] = await Promise.all([
      redis.lrange(prefix + "log:attended", 0, 49),
      redis.smembers(prefix + "attendedSet"),
    ]);
    const list = raw.map(s => JSON.parse(s)).sort((a, b) => b.ts - a.ts);
    const nums = attendedSet.map(n => Number(n));

    return json(200, { attended: list, numbers: nums, count: nums.length });
  } catch (error) {
    return errorHandler(error);
  }
}
