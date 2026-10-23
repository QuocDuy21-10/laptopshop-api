import { randomUUID } from "node:crypto";
import { prisma } from "config/client";
import { applyNotificationRetention } from "modules/notifications/notification-retention.service";
import { env } from "config/env";
import { logger } from "lib/logger";

export const recordWorkerHeartbeat = async (
  client: typeof prisma,
  workerName: string,
  instanceId: string,
  status: string,
  metadata: Record<string, unknown> = {},
) =>
  client.workerHeartbeat.upsert({
    where: { workerName_instanceId: { workerName, instanceId } },
    create: { workerName, instanceId, status, metadata: metadata as never },
    update: { status, metadata: metadata as never, lastSeenAt: new Date() },
  });

export const runNotificationMaintenanceOnce = async (
  now = new Date(),
  instanceId = randomUUID(),
) => {
  await recordWorkerHeartbeat(prisma, "notification-maintenance-worker", instanceId, "HEALTHY");
  return applyNotificationRetention(prisma, now);
};

const main = async () => {
  if (!env.NOTIFICATION_WORKER_ENABLED) return;
  const instanceId = randomUUID();
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  while (!stopping) {
    await runNotificationMaintenanceOnce(new Date(), instanceId);
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  }
  await prisma.$disconnect();
};
if (require.main === module)
  main().catch((error) => {
    logger.error({ error }, "notification maintenance worker failed");
    process.exit(1);
  });
