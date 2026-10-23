import { randomUUID } from "node:crypto";
import { prisma } from "config/client";
import { env } from "config/env";
import { createBullMqRedisClient, createQueue } from "queues/queue.factory";
import { NOTIFICATION_QUEUE_NAME } from "queues/notification.queue";
import { AFTER_SALES_QUEUE_NAME } from "queues/after-sales.queue";
import { PRICING_QUEUE_NAME } from "queues/pricing.queue";
import {
  claimOutboxBatch,
  dispatchOutboxBatch,
  markOutboxFailed,
  markOutboxPublished,
} from "modules/outbox/outbox.dispatcher";
import { logger } from "lib/logger";

export const runOutboxDispatcherOnce = async (
  connection: Awaited<ReturnType<typeof createBullMqRedisClient>>,
) => {
  const notificationQueue = createQueue(
    NOTIFICATION_QUEUE_NAME,
    connection,
    env.NOTIFICATION_QUEUE_PREFIX,
  );
  const pricingQueue = createQueue(PRICING_QUEUE_NAME, connection, env.NOTIFICATION_QUEUE_PREFIX);
  const afterSalesQueue = createQueue(
    AFTER_SALES_QUEUE_NAME,
    connection,
    env.AFTER_SALES_QUEUE_PREFIX,
  );
  const leaseOwner = randomUUID();
  return dispatchOutboxBatch({
    claim: () =>
      claimOutboxBatch(prisma, {
        now: new Date(),
        leaseOwner,
        leaseMs: env.OUTBOX_LEASE_MS,
        limit: env.OUTBOX_BATCH_SIZE,
      }),
    queueFor: (eventType) =>
      eventType === "NOTIFICATION_DELIVERY_REQUESTED"
        ? notificationQueue
        : eventType === "AFTER_SALES_MILESTONE_REQUESTED"
          ? afterSalesQueue
          : pricingQueue,
    markPublished: (id, owner) => markOutboxPublished(prisma, id, owner),
    markFailed: (id, owner, error) => markOutboxFailed(prisma, id, owner, error),
    now: new Date(),
    leaseOwner,
  });
};

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const main = async () => {
  if (!env.NOTIFICATION_OUTBOX_ENABLED) return;
  const connection = await createBullMqRedisClient(env.REDIS_URL);
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  try {
    while (!stopping) {
      await runOutboxDispatcherOnce(connection);
      if (!stopping) await delay(1_000);
    }
  } finally {
    await connection.disconnect();
    await prisma.$disconnect();
  }
};
if (require.main === module)
  main().catch((error) => {
    logger.error({ error }, "outbox dispatcher failed");
    process.exit(1);
  });
