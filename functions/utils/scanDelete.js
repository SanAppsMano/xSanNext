export async function scanDelete(redis, pattern, batchSize = 100) {
  let cursor = 0;
  do {
    const [next, keys] = await redis.scan(cursor, {
      match: pattern,
      count: batchSize,
    });
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    cursor = Number(next);
  } while (cursor !== 0);
}

export default scanDelete;
