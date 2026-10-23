import { randomUUID } from "node:crypto";
import { prisma } from "config/client";
import { env } from "config/env";
import { createBullMqRedisClient, createQueue } from "queues/queue.factory";
import { NOTIFICATION_QUEUE_NAME } from "queues/notification.queue";
import { PRICING_QUEUE_NAME } from "queues/pricing.queue";
import {
  claimOutboxBatch,
  dispatchOutboxBatch,
  markOutboxFailed,
  markOutboxPublished,
} from "modules/outbox/outbox.dispatcher";

export const runOutboxDispatcherOnce = async (
  connection: Awaited<ReturnType<typeof createBullMqRedisClient>>,
) => {
  const notificationQueue = createQueue(
    NOTIFICATION_QUEUE_NAME,
    connection,
    env.NOTIFICATION_QUEUE_PREFIX,
  );
  const pricingQueue = createQueue(PRICING_QUEUE_NAME, connection, env.NOTIFICATION_QUEUE_PREFIX);
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
      eventType === "NOTIFICATION_DELIVERY_REQUESTED" ? notificationQueue : pricingQueue,
    markPublished: (id, owner) => markOutboxPublished(prisma, id, owner),
    markFailed: (id, owner, error) => markOutboxFailed(prisma, id, owner, error),
    now: new Date(),
    leaseOwner,
  });
};
