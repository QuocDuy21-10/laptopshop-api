import { randomUUID } from "node:crypto";
import { prisma } from "config/client";
import { env } from "config/env";
import { logger } from "lib/logger";
import { processAfterSalesMilestone } from "modules/after-sales/after-sales-maintenance";
import { AFTER_SALES_QUEUE_NAME, type AfterSalesMilestoneJob } from "queues/after-sales.queue";
import { createBullMqRedisClient, createWorker } from "queues/queue.factory";

export const processAfterSalesJob = (job: AfterSalesMilestoneJob) =>
  processAfterSalesMilestone({
    itemId: job.itemId,
    itemVersion: job.itemVersion,
    milestone: job.milestone,
  });

const main = async () => {
  if (!env.AFTER_SALES_WORKER_ENABLED) return;
  const connection = await createBullMqRedisClient(env.REDIS_URL);
  const worker = createWorker<AfterSalesMilestoneJob>(
    AFTER_SALES_QUEUE_NAME,
    (job) => processAfterSalesJob(job.data),
    connection,
    env.AFTER_SALES_QUEUE_PREFIX,
  );
  worker.on("error", (error) => logger.error({ err: error }, "after-sales worker failed"));
  await new Promise<void>((resolve) => {
    const stop = async () => {
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
