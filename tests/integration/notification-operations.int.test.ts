import { prisma } from "config/client";
import { createProduct, createUser, resetDb } from "./fixtures";
import { applyNotificationRetention } from "modules/notifications/notification-retention.service";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("notification operations persistence", () => {
  it("retains a delivery audit while removing old outbox rows", async () => {
    const user = await createUser();
    const product = await createProduct(1);
    const notification = await prisma.notification.create({
      data: {
        userId: user.id,
        productId: product.id,
        type: "PRICE_DROP",
        title: "Old",
        message: "Old",
        dedupeKey: "operations-retention-notification",
      },
    });
    const delivery = await prisma.notificationDelivery.create({
      data: {
        notificationId: notification.id,
        parentType: "NOTIFICATION",
        channel: "EMAIL",
        dedupeKey: "operations-retention-delivery",
        destinationKey: user.username,
      },
    });
    await prisma.notificationDeliveryAudit.create({
      data: { deliveryId: delivery.id, actorId: user.id, action: "RETRY", reason: "test" },
    });
    await prisma.outboxEvent.create({
      data: {
        eventType: "NOTIFICATION_DELIVERY_REQUESTED",
        aggregateType: "NotificationDelivery",
        aggregateId: delivery.id,
        dedupeKey: "operations-retention-outbox",
        payload: { deliveryId: delivery.id },
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
      },
    });

    await applyNotificationRetention(prisma, new Date("2026-10-23T00:00:00.000Z"));
    await expect(prisma.notificationDeliveryAudit.count()).resolves.toBe(1);
  });
});
