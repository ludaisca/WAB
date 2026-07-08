import Redis from "ioredis";

let redis: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL || "redis://redis:6379", {
      maxRetriesPerRequest: null,
      retryStrategy(times: number) {
        return Math.min(times * 100, 3000);
      },
    });
  }
  return redis;
}
