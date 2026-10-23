import { dispatchOutboxBatch } from "modules/outbox/outbox.dispatcher";

describe("outbox dispatcher", () => {
  it("publishes delivery events with a deterministic hyphenated job id", async () => {
    const queue = { add: jest.fn().mockResolvedValue({ id: "job" }) };
    const events = [
      {
        id: 12,
        eventType: "NOTIFICATION_DELIVERY_REQUESTED" as const,
        aggregateType: "NotificationDelivery",
        aggregateId: 44,
        payload: { deliveryId: 44 },
      },
    ];
    const deps = {
      queueFor: jest.fn().mockReturnValue(queue),
      claim: jest.fn().mockResolvedValue(events),
      markPublished: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
      now: new Date("2026-10-23T00:00:00.000Z"),
      leaseOwner: "dispatcher-1",
    };

    await expect(dispatchOutboxBatch(deps)).resolves.toEqual({
      claimed: 1,
      published: 1,
      failed: 0,
    });
    expect(queue.add).toHaveBeenCalledWith(
      "NOTIFICATION_DELIVERY_REQUESTED",
      expect.objectContaining({ deliveryId: 44, outboxEventId: 12 }),
      expect.objectContaining({ jobId: "notification-delivery-44" }),
    );
    expect(queue.add.mock.calls[0][2].jobId).not.toContain(":");
    expect(deps.markPublished).toHaveBeenCalledWith(12, "dispatcher-1");
  });

  it("leaves an event unpublished when queue add fails so it can be retried", async () => {
    const deps = {
      queueFor: jest
        .fn()
        .mockReturnValue({ add: jest.fn().mockRejectedValue(new Error("redis down")) }),
      claim: jest.fn().mockResolvedValue([
        {
          id: 5,
          eventType: "NOTIFICATION_DELIVERY_REQUESTED" as const,
          aggregateType: "NotificationDelivery",
          aggregateId: 9,
          payload: { deliveryId: 9 },
        },
      ]),
      markPublished: jest.fn(),
      markFailed: jest.fn().mockResolvedValue(undefined),
      now: new Date(),
      leaseOwner: "dispatcher-1",
    };

    await expect(dispatchOutboxBatch(deps)).resolves.toEqual({
      claimed: 1,
      published: 0,
      failed: 1,
    });
    expect(deps.markPublished).not.toHaveBeenCalled();
    expect(deps.markFailed).toHaveBeenCalledWith(5, "dispatcher-1", expect.any(Error));
  });
});
