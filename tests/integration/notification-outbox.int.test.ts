import { prisma } from "config/client";
import { createProduct, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("notification outbox persistence", () => {
  it("stores one delivery outbox event and replays its dedupe key safely", async () => {
    const user = await createUser();
    const product = await createProduct(1);
    const notification = await prisma.notification.create({
      data: {
        userId: user.id,
        productId: product.id,
        type: "PRICE_DROP",
        title: "Giảm giá",
        message: "Sản phẩm vừa giảm giá",
        dedupeKey: "outbox-integration-notification",
      },
    });
    const delivery = await prisma.notificationDelivery.create({
      data: {
        notificationId: notification.id,
        parentType: "NOTIFICATION",
        channel: "EMAIL",
        dedupeKey: "outbox-integration-delivery",
        destinationKey: user.username,
      },
    });
    const event = await prisma.outboxEvent.create({
      data: {
        eventType: "NOTIFICATION_DELIVERY_REQUESTED",
        aggregateType: "NotificationDelivery",
        aggregateId: delivery.id,
        dedupeKey: "outbox-integration-event",
        payload: { deliveryId: delivery.id },
      },
    });

    await expect(prisma.outboxEvent.findUnique({ where: { id: event.id } })).resolves.toMatchObject(
      {
        publishedAt: null,
        payload: { deliveryId: delivery.id },
      },
    );
    await expect(
      prisma.outboxEvent.create({
        data: {
          eventType: "NOTIFICATION_DELIVERY_REQUESTED",
          aggregateType: "NotificationDelivery",
          aggregateId: delivery.id,
          dedupeKey: "outbox-integration-event",
          payload: { deliveryId: delivery.id },
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
