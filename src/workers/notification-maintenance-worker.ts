import { randomUUID } from "node:crypto";
import { prisma } from "config/client";
import { applyNotificationRetention } from "modules/notifications/notification-retention.service";

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

export const runNotificationMaintenanceOnce = async (now = new Date()) => {
  const instanceId = randomUUID();
  await recordWorkerHeartbeat(prisma, "notification-maintenance-worker", instanceId, "HEALTHY");
  return applyNotificationRetention(prisma, now);
};
