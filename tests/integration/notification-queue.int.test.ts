import { prisma } from "config/client";
import { claimOutboxBatch } from "modules/outbox/outbox.repository";
import { dispatchOutboxBatch } from "modules/outbox/outbox.dispatcher";
import { createProduct, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("notification queue recovery", () => {
  it("replays an outbox delivery with one deterministic job id", async () => {
    const user = await createUser();
    const product = await createProduct(1);
    const notification = await prisma.notification.create({
      data: {
        userId: user.id,
        productId: product.id,
        type: "PRICE_DROP",
        title: "Queue",
        message: "Queue",
        dedupeKey: "queue-recovery-notification",
      },
    });
    const delivery = await prisma.notificationDelivery.create({
      data: {
        notificationId: notification.id,
        parentType: "NOTIFICATION",
        channel: "EMAIL",
        dedupeKey: "queue-recovery-delivery",
        destinationKey: user.username,
      },
    });
    const event = await prisma.outboxEvent.create({
      data: {
        eventType: "NOTIFICATION_DELIVERY_REQUESTED",
        aggregateType: "NotificationDelivery",
        aggregateId: delivery.id,
        dedupeKey: "queue-recovery-event",
        payload: { deliveryId: delivery.id },
      },
    });
    const jobs: Array<{ jobId: string }> = [];
    const makeDeps = () => ({
      claim: () =>
        claimOutboxBatch(prisma, {
          now: new Date(),
          leaseOwner: "integration-dispatcher",
          leaseMs: 60_000,
          limit: 10,
        }),
      queueFor: () => ({
        add: async (_name: string, _data: unknown, options: { jobId: string }) => {
          jobs.push({ jobId: options.jobId });
        },
      }),
      markPublished: (id: number, owner: string) =>
        prisma.outboxEvent
          .updateMany({
            where: { id, leaseOwner: owner },
            data: { publishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null },
          })
          .then(() => undefined),
      markFailed: async () => undefined,
      now: new Date(),
      leaseOwner: "integration-dispatcher",
    });

    await dispatchOutboxBatch(makeDeps());
    expect(jobs).toEqual([{ jobId: "notification-delivery-" + delivery.id }]);
    await expect(prisma.outboxEvent.findUnique({ where: { id: event.id } })).resolves.toMatchObject(
      {
        publishedAt: expect.any(Date),
      },
    );
  });

  it("reclaims an expired outbox lease exactly once", async () => {
    const first = await prisma.outboxEvent.create({
      data: {
        eventType: "NOTIFICATION_DELIVERY_REQUESTED",
        aggregateType: "NotificationDelivery",
        aggregateId: 1,
        dedupeKey: "queue-lease-event",
        payload: { deliveryId: 1 },
        leaseOwner: "dead-worker",
        leaseExpiresAt: new Date(Date.now() - 60_000),
      },
    });
    const claimed = await claimOutboxBatch(prisma, {
      now: new Date(),
      leaseOwner: "recovery-worker",
      leaseMs: 60_000,
      limit: 10,
    });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ id: first.id, leaseOwner: "recovery-worker" });
  });
});
