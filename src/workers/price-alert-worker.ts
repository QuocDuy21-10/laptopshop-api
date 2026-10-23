import "../instrument";
import { randomUUID } from "crypto";
import { prisma } from "config/client";
import { env } from "config/env";
import { createRedisClient } from "config/redis";
import { logger } from "lib/logger";
import { runLockedPriceAlertSweep } from "modules/price-alerts/price-alert.runner";
import { evaluatePricingEvent } from "modules/price-alerts/price-alert.service";
import { createBullMqRedisClient, createWorker } from "queues/queue.factory";
import { PRICING_QUEUE_NAME, type PricingEvaluationJob } from "queues/pricing.queue";

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const main = async () => {
  const redis = createRedisClient(env.REDIS_URL);
  await redis.connect();
  const queueConnection = env.NOTIFICATION_OUTBOX_ENABLED
    ? await createBullMqRedisClient(env.REDIS_URL)
    : null;
  const pricingWorker = queueConnection
    ? createWorker<PricingEvaluationJob>(
        PRICING_QUEUE_NAME,
        async (job) =>
          evaluatePricingEvent(prisma, job.data, new Date(), env.PRICE_ALERT_PRODUCT_BATCH_SIZE),
        queueConnection,
        env.NOTIFICATION_QUEUE_PREFIX,
        { concurrency: 1 },
      )
    : null;
  let stopping = false;
  let stopResolve!: () => void;
  const stopped = new Promise<void>((resolve) => {
    stopResolve = resolve;
  });

  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    stopResolve();
    logger.info("price alert worker shutting down");
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  try {
    while (!stopping) {
      await runLockedPriceAlertSweep({
        redis,
        client: prisma,
        now: () => new Date(),
        productBatchSize: env.PRICE_ALERT_PRODUCT_BATCH_SIZE,
        lockTtlMs: env.PRICE_ALERT_LOCK_TTL_MS,
        token: randomUUID,
        logger,
      });
      if (!stopping) await Promise.race([delay(env.PRICE_ALERT_INTERVAL_MS), stopped]);
    }
  } finally {
    await pricingWorker?.close();
    await queueConnection?.disconnect();
    await Promise.allSettled([redis.quit(), prisma.$disconnect()]);
  }
};

main().catch((error) => {
  logger.error({ error }, "price alert worker failed");
  process.exit(1);
});
