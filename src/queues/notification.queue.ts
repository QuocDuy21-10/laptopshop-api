export const NOTIFICATION_QUEUE_NAME = "notification-delivery-v1";

export type NotificationDeliveryJob = {
  outboxEventId: number;
  deliveryId: number;
};
