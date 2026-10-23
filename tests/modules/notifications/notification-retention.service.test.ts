import { applyNotificationRetention } from "modules/notifications/notification-retention.service";

describe("notification retention", () => {
  it("deletes each retention class by a bounded cutoff", async () => {
    const client = {
      notification: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      notificationDelivery: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
      outboxEvent: { deleteMany: jest.fn().mockResolvedValue({ count: 4 }) },
      emailVerificationChallenge: { deleteMany: jest.fn().mockResolvedValue({ count: 5 }) },
      pushSubscription: { deleteMany: jest.fn().mockResolvedValue({ count: 6 }) },
    };

    await expect(
      applyNotificationRetention(client, new Date("2026-10-23T00:00:00.000Z")),
    ).resolves.toMatchObject({
      notifications: 2,
      deliveries: 3,
      outbox: 4,
      challenges: 5,
      subscriptions: 6,
    });
    expect(client.notification.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { createdAt: { lt: new Date("2026-04-26T00:00:00.000Z") } },
      }),
    );
  });
});
