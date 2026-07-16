import { getRedisClient } from "@/lib/redis";

const memoryStore = new Map<string, number[]>();

export async function rateLimit(
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number }> {
  const fullKey = `ratelimit:${key}`;
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;

  try {
    const r = getRedisClient();

    const multi = r.multi();
    multi.zremrangebyscore(fullKey, 0, windowStart);
    multi.zcard(fullKey);
    multi.zadd(fullKey, now, `${now}_${Math.random()}`);
    multi.expire(fullKey, windowSeconds + 1);

    const [, current] = (await multi.exec()) ?? [[null, 0], [null, 0]];
    const count = (current?.[1] as number) || 0;
    return { allowed: count < maxRequests, remaining: Math.max(0, maxRequests - count - 1) };
  } catch {
    // Poda de claves muertas: sin esto, con Redis caído un rato el Map crece
    // sin límite (una entrada por IP/usuario que jamás se libera).
    if (memoryStore.size > 500) {
      for (const [key, ts] of memoryStore) {
        if (ts.every((t) => t <= windowStart)) memoryStore.delete(key);
      }
    }
    const timestamps = memoryStore.get(fullKey) ?? [];
    const valid = timestamps.filter((t) => t > windowStart);
    valid.push(now);
    memoryStore.set(fullKey, valid);
    return { allowed: valid.length <= maxRequests, remaining: Math.max(0, maxRequests - valid.length) };
  }
}
