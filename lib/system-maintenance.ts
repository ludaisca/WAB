import { prisma } from "@/lib/prisma";
import { ALL_QUEUES, restoreQueue } from "@/lib/queue";
import { getRedisClient } from "@/lib/redis";
import { ACTIVE_REQUESTS_KEY, MAINTENANCE_KEY } from "./maintenance-state";

const SYSTEM_CONFIG_ID = "default";

export async function isMaintenanceMode(): Promise<boolean> {
  if (await getRedisClient().exists(MAINTENANCE_KEY)) return true;
  const config = await prisma.systemConfig.findUnique({
    where: { id: SYSTEM_CONFIG_ID }, select: { maintenanceMode: true },
  });
  return config?.maintenanceMode ?? false;
}

export async function enterMaintenanceMode(reason: string): Promise<void> {
  const redis = getRedisClient();
  const alreadyInMaintenance = await redis.exists(MAINTENANCE_KEY);
  await redis.set(MAINTENANCE_KEY, "1");
  try {
    await prisma.systemConfig.upsert({
      where: { id: SYSTEM_CONFIG_ID },
      update: { maintenanceMode: true, maintenanceReason: reason, maintenanceStartedAt: new Date() },
      create: { id: SYSTEM_CONFIG_ID, maintenanceMode: true, maintenanceReason: reason, maintenanceStartedAt: new Date() },
    });
    await Promise.all(ALL_QUEUES.map((queue) => queue.pause()));
    // Queue.pause() no espera trabajos activos. El propio restore se excluye
    // para no esperarse a sí mismo. Las peticiones HTTP también deben terminar.
    const deadline = Date.now() + (Number(process.env.MAINTENANCE_DRAIN_TIMEOUT_MS) || 120_000);
    for (;;) {
      await redis.zremrangebyscore(ACTIVE_REQUESTS_KEY, "-inf", Date.now());
      const [requests, ...activeJobs] = await Promise.all([
        redis.zcard(ACTIVE_REQUESTS_KEY),
        ...ALL_QUEUES.filter((queue) => queue !== restoreQueue).map((queue) => queue.getActiveCount()),
      ]);
      if (requests === 0 && activeJobs.every((count) => count === 0)) return;
      if (Date.now() >= deadline) throw new Error("Hay operaciones activas: se canceló la restauración antes de modificar datos. Reintenta al terminar esas operaciones.");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } catch (error) {
    if (!alreadyInMaintenance) await exitMaintenanceMode();
    else await restoreQueue.resume();
    throw error;
  }
}

export async function exitMaintenanceMode(): Promise<void> {
  await prisma.systemConfig.upsert({
    where: { id: SYSTEM_CONFIG_ID },
    update: { maintenanceMode: false, maintenanceReason: null, maintenanceStartedAt: null },
    create: { id: SYSTEM_CONFIG_ID, maintenanceMode: false },
  });
  await getRedisClient().del(MAINTENANCE_KEY);
  await Promise.all(ALL_QUEUES.map((queue) => queue.resume()));
}

export async function handleFailedRestore(destructiveStarted: boolean): Promise<void> {
  // Solo se permite una recuperación explícita. Los trabajos de negocio y
  // peticiones normales permanecen bloqueados si BD y medios pueden diferir.
  if (destructiveStarted) await restoreQueue.resume();
  else await exitMaintenanceMode();
}
