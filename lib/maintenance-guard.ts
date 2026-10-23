import { randomUUID } from "node:crypto";
import { getRedisClient } from "@/lib/redis";
import { isMaintenanceMode } from "@/lib/system-maintenance";
import { ACTIVE_REQUESTS_KEY, MAINTENANCE_KEY } from "./maintenance-state";

const LEASE_MS = 90_000;
const ACQUIRE = `
  redis.call('zremrangebyscore', KEYS[2], '-inf', ARGV[1])
  if redis.call('exists', KEYS[1]) == 1 then return 0 end
  redis.call('zadd', KEYS[2], ARGV[2], ARGV[3])
  return 1
`;

// Se aplica al handler, no a proxy.ts: el proxy de Next trunca subidas grandes.
// El lease cubre TODA la solicitud (incluidos envíos externos y streaming de
// uploads); restauración espera a que terminen las solicitudes admitidas.
export function withMaintenanceGuard<T extends unknown[]>(handler: (...args: T) => Promise<Response>) {
  return async (...args: T): Promise<Response> => {
    const unavailable = () => Response.json({ error: "Sistema en mantenimiento. Intenta de nuevo en unos minutos." }, { status: 503, headers: { "Retry-After": "30" } });
    const redis = getRedisClient();
    if (await isMaintenanceMode()) return unavailable();
    const owner = randomUUID();
    const now = Date.now();
    const admitted = await redis.eval(ACQUIRE, 2, MAINTENANCE_KEY, ACTIVE_REQUESTS_KEY, now, now + LEASE_MS, owner);
    if (!admitted) return unavailable();
    const heartbeat = setInterval(() => {
      void redis.zadd(ACTIVE_REQUESTS_KEY, "XX", Date.now() + LEASE_MS, owner)
        .catch((error) => console.error("[maintenance] Error renovando solicitud:", error));
    }, 15_000);
    heartbeat.unref();
    try {
      return await handler(...args);
    } finally {
      clearInterval(heartbeat);
      await redis.zrem(ACTIVE_REQUESTS_KEY, owner);
    }
  };
}
