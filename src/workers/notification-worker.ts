import { createBullMqRedisClient, createWorker } from "queues/queue.factory";
import { NOTIFICATION_QUEUE_NAME, type NotificationDeliveryJob } from "queues/notification.queue";
import { processNotificationDelivery } from "modules/notifications/notification-delivery.service";

export const createNotificationDeliveryWorker = (
  connection: Awaited<ReturnType<typeof createBullMqRedisClient>>,
  deps: Parameters<typeof processNotificationDelivery>[0],
  prefix: string,
) =>
  createWorker<NotificationDeliveryJob>(
    NOTIFICATION_QUEUE_NAME,
    async (job) => processNotificationDelivery(deps, job.data.deliveryId),
    connection,
    prefix,
    { concurrency: 10 },
  );
