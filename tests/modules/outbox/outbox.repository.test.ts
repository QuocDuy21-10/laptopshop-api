import { claimOutboxBatch, createOutboxEvent } from "modules/outbox/outbox.repository";

describe("outbox repository", () => {
  it("creates a versioned event with a canonical payload", async () => {
    const create = jest.fn().mockResolvedValue({ id: 3 });
    const tx = { outboxEvent: { create } };

    await expect(
      createOutboxEvent(tx, {
        eventType: "NOTIFICATION_DELIVERY_REQUESTED",
        aggregateType: "NotificationDelivery",
        aggregateId: 12,
        dedupeKey: "delivery-12",
        payload: { deliveryId: 12 },
      }),
    ).resolves.toEqual({ id: 3 });

    expect(create).toHaveBeenCalledWith({
      data: {
        eventType: "NOTIFICATION_DELIVERY_REQUESTED",
        schemaVersion: 1,
        aggregateType: "NotificationDelivery",
        aggregateId: 12,
        dedupeKey: "delivery-12",
        payload: { deliveryId: 12 },
      },
    });
  });

  it("claims only available and unleased rows with an owner lease", async () => {
    const rows = [
      {
        id: 1,
        eventType: "PRICE_REEVALUATION_REQUESTED",
        aggregateId: 7,
        dedupeKey: "price-7",
        availableAt: new Date("2026-10-23T00:00:00.000Z"),
        publishedAt: null,
      },
    ];
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      outboxEvent: {
        findMany: jest.fn().mockResolvedValue(rows),
        updateMany,
      },
    };
    const client = {
      $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const now = new Date("2026-10-23T00:01:00.000Z");

    await expect(
      claimOutboxBatch(client, { now, leaseOwner: "dispatcher-1", leaseMs: 60_000, limit: 10 }),
    ).resolves.toEqual([
      {
        ...rows[0],
        leaseOwner: "dispatcher-1",
        leaseExpiresAt: new Date("2026-10-23T00:02:00.000Z"),
      },
    ]);
    expect(tx.outboxEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          publishedAt: null,
          availableAt: { lte: now },
        }),
        take: 10,
      }),
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 1, publishedAt: null }),
        data: expect.objectContaining({ leaseOwner: "dispatcher-1" }),
      }),
    );
  });
});
