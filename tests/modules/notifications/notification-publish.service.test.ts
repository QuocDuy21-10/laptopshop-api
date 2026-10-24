import { publishNotification } from "modules/notifications/notification-publish.service";

const notification = {
  id: 9,
  userId: 11,
  serviceRequestId: 90,
  productId: null,
  type: "AFTER_SALES_STATUS_CHANGED",
  title: "Cập nhật",
  message: "Đã cập nhật",
  dedupeKey: "after-sales-90-status-1",
};

const txFor = (
  preference: Record<string, boolean> | null,
  subscriptions = [{ id: 3, endpointHash: "push-3" }],
) => {
  const deliveryRows: Array<{ id: number; channel: string; dedupeKey: string }> = [];
  return {
    notification: {
      upsert: jest.fn().mockResolvedValue(notification),
    },
    notificationPreference: { findUnique: jest.fn().mockResolvedValue(preference) },
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ username: "user@test.local", emailVerifiedAt: new Date() }),
    },
    pushSubscription: { findMany: jest.fn().mockResolvedValue(subscriptions) },
    notificationDelivery: {
      upsert: jest
        .fn()
        .mockImplementation(
          async ({ create }: { create: { channel: string; dedupeKey: string } }) => {
            const existing = deliveryRows.find((row) => row.dedupeKey === create.dedupeKey);
            if (existing) return existing;
            const row = {
              id: deliveryRows.length + 1,
              channel: create.channel,
              dedupeKey: create.dedupeKey,
            };
            deliveryRows.push(row);
            return row;
          },
        ),
    },
    outboxEvent: { upsert: jest.fn().mockResolvedValue({ id: 20 }) },
    deliveryRows,
  };
};

describe("notification publisher", () => {
  it("creates only the consented after-sales delivery channels and dedupes repeats", async () => {
    const tx = txFor({
      emailEnabled: true,
      webPushEnabled: true,
      afterSalesEmailEnabled: true,
      afterSalesWebPushEnabled: false,
    });
    await publishNotification(tx as never, {
      category: "AFTER_SALES",
      userId: 11,
      serviceRequestId: 90,
      type: "AFTER_SALES_STATUS_CHANGED",
      title: "Cập nhật",
      message: "Đã cập nhật",
      dedupeKey: "after-sales-90-status-1",
    });
    await publishNotification(tx as never, {
      category: "AFTER_SALES",
      userId: 11,
      serviceRequestId: 90,
      type: "AFTER_SALES_STATUS_CHANGED",
      title: "Cập nhật",
      message: "Đã cập nhật",
      dedupeKey: "after-sales-90-status-1",
    });

    expect(tx.deliveryRows).toHaveLength(1);
    expect(tx.deliveryRows[0].channel).toBe("EMAIL");
    expect(tx.outboxEvent.upsert).toHaveBeenCalledTimes(2);
  });

  it("supports push-only after-sales consent with multiple subscriptions", async () => {
    const tx = txFor(
      {
        emailEnabled: false,
        webPushEnabled: true,
        afterSalesEmailEnabled: false,
        afterSalesWebPushEnabled: true,
      },
      [
        { id: 3, endpointHash: "push-3" },
        { id: 4, endpointHash: "push-4" },
      ],
    );
    await publishNotification(tx as never, {
      category: "AFTER_SALES",
      userId: 11,
      serviceRequestId: 90,
      type: "AFTER_SALES_STATUS_CHANGED",
      title: "Cập nhật",
      message: "Đã cập nhật",
      dedupeKey: "after-sales-90-status-2",
    });
    expect(tx.deliveryRows.map((row) => row.channel)).toEqual(["WEB_PUSH", "WEB_PUSH"]);
  });
});
