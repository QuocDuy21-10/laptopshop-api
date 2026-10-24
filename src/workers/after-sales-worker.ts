import { randomUUID } from "node:crypto";
import { prisma } from "config/client";
import { env } from "config/env";
import { createS3ObjectStorage } from "lib/storage/s3-object-storage";
import type { ObjectStorage } from "lib/storage/object-storage";
import { logger } from "lib/logger";
import { processAfterSalesMilestone } from "modules/after-sales/after-sales-maintenance";
import { cleanupServiceAttachment } from "modules/after-sales/after-sales-attachment-cleanup";
import { recordWorkerHeartbeat } from "modules/workers/worker-heartbeat.service";
import { AFTER_SALES_QUEUE_NAME, type AfterSalesMilestoneJob } from "queues/after-sales.queue";
import { createBullMqRedisClient, createWorker } from "queues/queue.factory";

export const processAfterSalesJob = (job: AfterSalesMilestoneJob, storage?: ObjectStorage) =>
  job.jobType === "ATTACHMENT_DELETE"
    ? storage
      ? cleanupServiceAttachment({ storage }, job.attachmentId)
      : Promise.reject(new Error("After-sales attachment storage is unavailable"))
    : processAfterSalesMilestone({
        itemId: job.itemId,
        itemVersion: job.itemVersion,
        milestone: job.milestone,
      });

const main = async () => {
  if (!env.AFTER_SALES_WORKER_ENABLED) return;
  const connection = await createBullMqRedisClient(env.REDIS_URL);
  const storage = createS3ObjectStorage({
    enabled: env.AFTER_SALES_IMAGES_ENABLED,
    endpoint: env.AFTER_SALES_IMAGE_S3_ENDPOINT,
    region: env.AFTER_SALES_IMAGE_S3_REGION,
    bucket: env.AFTER_SALES_IMAGE_S3_BUCKET,
    accessKeyId: env.AFTER_SALES_IMAGE_S3_ACCESS_KEY_ID,
    secretAccessKey: env.AFTER_SALES_IMAGE_S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.AFTER_SALES_IMAGE_S3_FORCE_PATH_STYLE,
    prefix: "after-sales",
  });
  const instanceId = randomUUID();
  await recordWorkerHeartbeat(prisma, "after-sales-worker", instanceId, "HEALTHY");
  const worker = createWorker<AfterSalesMilestoneJob>(
    AFTER_SALES_QUEUE_NAME,
    async (job) => {
      await recordWorkerHeartbeat(prisma, "after-sales-worker", instanceId, "HEALTHY", {
        milestone: "milestone" in job.data ? job.data.milestone : "ATTACHMENT_DELETE",
      });
      return processAfterSalesJob(job.data, storage ?? undefined);
    },
    connection,
    env.AFTER_SALES_QUEUE_PREFIX,
  );
  worker.on("error", (error) => logger.error({ err: error }, "after-sales worker failed"));
  const heartbeat = setInterval(() => {
    void recordWorkerHeartbeat(prisma, "after-sales-worker", instanceId, "HEALTHY");
  }, 60_000);
  heartbeat.unref();
  await new Promise<void>((resolve) => {
    const stop = async () => {
      clearInterval(heartbeat);
      await recordWorkerHeartbeat(prisma, "after-sales-worker", instanceId, "STOPPING");
      await worker.close();
      await connection.disconnect();
      resolve();
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  });
  await prisma.$disconnect();
};

if (require.main === module)
  main().catch((error) => {
    logger.error({ err: error, workerId: randomUUID() }, "after-sales worker failed");
    process.exit(1);
  });
