import type { PrismaClient, WorkerHeartbeat } from "@prisma/client";

export const recordWorkerHeartbeat = async (
  client: Pick<PrismaClient, "workerHeartbeat">,
  workerName: string,
  instanceId: string,
  status: string,
  metadata: Record<string, unknown> = {},
): Promise<WorkerHeartbeat> =>
  client.workerHeartbeat.upsert({
    where: { workerName_instanceId: { workerName, instanceId } },
    create: { workerName, instanceId, status, metadata: metadata as never },
    update: { status, metadata: metadata as never, lastSeenAt: new Date() },
  });
