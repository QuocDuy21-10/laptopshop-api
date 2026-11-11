import { env } from "config/env";
import { logger } from "lib/logger";
import { prisma } from "config/client";
import { createBullMqRedisClient, createWorker } from "queues/queue.factory";
import { NOTIFICATION_QUEUE_NAME, type NotificationDeliveryJob } from "queues/notification.queue";
import { createWebPushProvider } from "modules/notifications/providers/web-push.provider";
import { processNotificationDelivery } from "modules/notifications/notification-delivery.service";
import { createEmailProviderFromEnv } from "modules/notifications/providers/email-provider.factory";

export const createNotificationDeliveryWorker = (
  connection: Awaited<ReturnType<typeof createBullMqRedisClient>>,
  deps: Parameters<typeof processNotificationDelivery>[0],
  prefix: string,
) =>
  createWorker<NotificationDeliveryJob>(
    NOTIFICATION_QUEUE_NAME,
    async (job) => {
      const result = await processNotificationDelivery(deps, job.data.deliveryId);
      if (result === "retrying")
        throw Object.assign(new Error("notification delivery retry"), { retryable: true });
      return result;
    },
    connection,
    prefix,
    { concurrency: 10 },
  );

const main = async () => {
  if (!env.NOTIFICATION_WORKER_ENABLED) return;
  const connection = await createBullMqRedisClient(env.REDIS_URL);
  const providers: Parameters<typeof processNotificationDelivery>[0]["providers"] = {};
  const emailProvider = createEmailProviderFromEnv();
  if (emailProvider) providers.EMAIL = emailProvider;
  if (env.WEB_PUSH_ENABLED)
    providers.WEB_PUSH = createWebPushProvider({
      subject: env.VAPID_SUBJECT!,
      publicKey: env.VAPID_PUBLIC_KEY!,
      privateKey: env.VAPID_PRIVATE_KEY!,
    });
  const worker = createNotificationDeliveryWorker(
    connection,
    {
      client: prisma,
      providers,
      now: () => new Date(),
      leaseOwner: `notification-worker-${process.pid}`,
      maxAttempts: env.DELIVERY_MAX_ATTEMPTS,
    },
    env.NOTIFICATION_QUEUE_PREFIX,
  );
  const shutdown = () => {
    void worker
      .close()
      .then(() => connection.disconnect())
      .then(() => prisma.$disconnect());
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
};
if (require.main === module)
  main().catch((error) => {
    logger.error({ error }, "notification worker failed");
    process.exit(1);
  });
