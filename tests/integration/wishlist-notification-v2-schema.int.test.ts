import { prisma } from "config/client";
import { createProduct, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const notificationData = (userId: number, productId: number) => ({
  userId,
  productId,
  type: "PRICE_DROP" as const,
  title: "Giảm giá",
  message: "Sản phẩm vừa giảm giá",
  oldPrice: 1_000,
  newPrice: 900,
  dedupeKey: "price-alert-" + userId + "-" + productId,
});

describe("wishlist and notification v2 schema contract", () => {
  it("defaults legacy wishlist alerts to stable configuration", async () => {
    const user = await createUser();
    const product = await createProduct(1);
    const item = await prisma.wishlistItem.create({
      data: { userId: user.id, productId: product.id },
    });

    expect(item).toMatchObject({ includeFlashSale: false, alertVersion: 1 });
  });

  it("enforces one preference and one push endpoint per user", async () => {
    const user = await createUser();
    await prisma.notificationPreference.create({ data: { userId: user.id } });
    await expect(
      prisma.notificationPreference.create({ data: { userId: user.id } }),
    ).rejects.toMatchObject({
      code: "P2002",
    });

    await prisma.pushSubscription.create({
      data: {
        userId: user.id,
        endpoint: "https://push.example/1",
        endpointHash: "hash-1",
        p256dh: "p256dh",
        auth: "auth",
      },
    });
    await expect(
      prisma.pushSubscription.create({
        data: {
          userId: user.id,
          endpoint: "https://push.example/1",
          endpointHash: "hash-1",
          p256dh: "p256dh",
          auth: "auth",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("requires a declared delivery parent and dedupes email push and otp deliveries", async () => {
    const user = await createUser();
    const product = await createProduct(1);
    const notification = await prisma.notification.create({
      data: notificationData(user.id, product.id),
    });
    const challenge = await prisma.emailVerificationChallenge.create({
      data: {
        userId: user.id,
        email: user.username,
        otpHash: "hash",
        otpCiphertext: "ciphertext",
        otpIv: "iv",
        otpTag: "tag",
        encryptionKeyVersion: "v1",
        expiresAt: new Date(Date.now() + 600_000),
      },
    });
    const delivery = await prisma.notificationDelivery.create({
      data: {
        notificationId: notification.id,
        parentType: "NOTIFICATION",
        channel: "EMAIL",
        dedupeKey: "delivery-email-1",
        destinationKey: user.username,
      },
    });

    await expect(
      prisma.notificationDelivery.create({
        data: {
          notificationId: notification.id,
          parentType: "NOTIFICATION",
          channel: "EMAIL",
          dedupeKey: "delivery-email-1",
          destinationKey: user.username,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    await expect(
      prisma.notificationDelivery.create({
        data: {
          emailVerificationChallengeId: challenge.id,
          parentType: "EMAIL_VERIFICATION",
          channel: "EMAIL",
          dedupeKey: "delivery-otp-1",
          destinationKey: user.username,
        },
      }),
    ).resolves.toMatchObject({ emailVerificationChallengeId: challenge.id });

    await prisma.notificationDeliveryAudit.create({
      data: { deliveryId: delivery.id, actorId: user.id, action: "RETRY", reason: "test" },
    });
  });

  it("dedupes outbox events and keeps worker heartbeat rows unique", async () => {
    const first = await prisma.outboxEvent.create({
      data: {
        eventType: "NOTIFICATION_DELIVERY_REQUESTED",
        aggregateType: "NotificationDelivery",
        aggregateId: 1,
        dedupeKey: "outbox-1",
        payload: { deliveryId: 1 },
      },
    });
    expect(first.publishAttempts).toBe(0);
    await expect(
      prisma.outboxEvent.create({
        data: {
          eventType: "NOTIFICATION_DELIVERY_REQUESTED",
          aggregateType: "NotificationDelivery",
          aggregateId: 1,
          dedupeKey: "outbox-1",
          payload: { deliveryId: 1 },
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    await prisma.workerHeartbeat.create({
      data: { workerName: "notification-worker", instanceId: "test-1", status: "HEALTHY" },
    });
    await expect(
      prisma.workerHeartbeat.create({
        data: { workerName: "notification-worker", instanceId: "test-1", status: "HEALTHY" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("cascades private notification state when its user is deleted", async () => {
    const user = await createUser();
    const product = await createProduct(1);
    await prisma.notificationPreference.create({ data: { userId: user.id } });
    await prisma.pushSubscription.create({
      data: {
        userId: user.id,
        endpoint: "https://push.example/delete",
        endpointHash: "delete-hash",
        p256dh: "p256dh",
        auth: "auth",
      },
    });
    const notification = await prisma.notification.create({
      data: notificationData(user.id, product.id),
    });
    await prisma.notificationDelivery.create({
      data: {
        notificationId: notification.id,
        parentType: "NOTIFICATION",
        channel: "WEB_PUSH",
        dedupeKey: "delivery-delete",
        destinationKey: "delete-hash",
      },
    });

    await prisma.user.delete({ where: { id: user.id } });

    await expect(prisma.notificationPreference.count({ where: { userId: user.id } })).resolves.toBe(
      0,
    );
    await expect(prisma.pushSubscription.count({ where: { userId: user.id } })).resolves.toBe(0);
    await expect(prisma.notification.count({ where: { userId: user.id } })).resolves.toBe(0);
  });
});
