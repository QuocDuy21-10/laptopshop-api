import { Prisma, NotificationType } from "@prisma/client";

export type NotificationCategory = "PRICE_ALERT" | "AFTER_SALES";

export type NotificationPublishInput = {
  category: NotificationCategory;
  userId: number;
  type: NotificationType;
  title: string;
  message: string;
  dedupeKey: string;
  serviceRequestId?: number | null;
  productId?: number | null;
  oldPrice?: number | null;
  newPrice?: number | null;
  priceSource?: Prisma.NotificationUncheckedCreateInput["priceSource"];
  promotionId?: number | null;
  pricingVersion?: number | null;
  validUntil?: Date | null;
};

export type NotificationPublishTx = Pick<
  Prisma.TransactionClient,
  | "notification"
  | "notificationPreference"
  | "user"
  | "pushSubscription"
  | "notificationDelivery"
  | "outboxEvent"
>;

const createDeliveryOutbox = async (
  tx: NotificationPublishTx,
  delivery: { id: number },
  notificationId: number,
) =>
  tx.outboxEvent.upsert({
    where: { dedupeKey: `delivery-outbox-${delivery.id}` },
    create: {
      eventType: "NOTIFICATION_DELIVERY_REQUESTED",
      aggregateType: "NotificationDelivery",
      aggregateId: delivery.id,
      dedupeKey: `delivery-outbox-${delivery.id}`,
      payload: { deliveryId: delivery.id, notificationId },
    },
    update: {},
  });

export const publishNotification = async (
  tx: NotificationPublishTx,
  input: NotificationPublishInput,
) => {
  const notification = await tx.notification.upsert({
    where: { dedupeKey: input.dedupeKey },
    create: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      dedupeKey: input.dedupeKey,
      ...(input.serviceRequestId !== undefined ? { serviceRequestId: input.serviceRequestId } : {}),
      ...(input.productId !== undefined ? { productId: input.productId } : {}),
      ...(input.oldPrice !== undefined ? { oldPrice: input.oldPrice } : {}),
      ...(input.newPrice !== undefined ? { newPrice: input.newPrice } : {}),
      ...(input.priceSource !== undefined ? { priceSource: input.priceSource } : {}),
      ...(input.promotionId !== undefined ? { promotionId: input.promotionId } : {}),
      ...(input.pricingVersion !== undefined ? { pricingVersion: input.pricingVersion } : {}),
      ...(input.validUntil !== undefined ? { validUntil: input.validUntil } : {}),
    },
    update: {},
  });

  const [preference, user] = await Promise.all([
    tx.notificationPreference.findUnique({ where: { userId: input.userId } }),
    tx.user.findUnique({
      where: { id: input.userId },
      select: { username: true, emailVerifiedAt: true },
    }),
  ]);
  const afterSales = input.category === "AFTER_SALES";
  const emailEnabled = Boolean(
    preference?.emailEnabled &&
    (!afterSales || preference.afterSalesEmailEnabled) &&
    user?.emailVerifiedAt,
  );
  if (emailEnabled && user) {
    const delivery = await tx.notificationDelivery.upsert({
      where: { dedupeKey: `notification-email-${notification.id}-${user.username}` },
      create: {
        notificationId: notification.id,
        parentType: "NOTIFICATION",
        channel: "EMAIL",
        dedupeKey: `notification-email-${notification.id}-${user.username}`,
        destinationKey: user.username,
      },
      update: {},
    });
    await createDeliveryOutbox(tx, delivery, notification.id);
  }

  const pushEnabled = Boolean(
    preference?.webPushEnabled && (!afterSales || preference.afterSalesWebPushEnabled),
  );
  if (pushEnabled) {
    const subscriptions = await tx.pushSubscription.findMany({
      where: { userId: input.userId, disabledAt: null },
      select: { id: true, endpointHash: true },
    });
    for (const subscription of subscriptions) {
      const delivery = await tx.notificationDelivery.upsert({
        where: { dedupeKey: `notification-push-${notification.id}-${subscription.id}` },
        create: {
          notificationId: notification.id,
          parentType: "NOTIFICATION",
          pushSubscriptionId: subscription.id,
          channel: "WEB_PUSH",
          dedupeKey: `notification-push-${notification.id}-${subscription.id}`,
          destinationKey: subscription.endpointHash,
        },
        update: {},
      });
      await createDeliveryOutbox(tx, delivery, notification.id);
    }
  }
  return notification;
};
