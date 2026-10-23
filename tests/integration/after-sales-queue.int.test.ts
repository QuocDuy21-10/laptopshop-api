import { prisma } from "config/client";
import { resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("after-sales queue events", () => {
  it("persists a deduplicated milestone outbox payload", async () => {
    const event = await prisma.outboxEvent.create({
      data: {
        eventType: "AFTER_SALES_MILESTONE_REQUESTED",
        aggregateType: "ServiceRequestItem",
        aggregateId: 7,
        dedupeKey: "after-sales-queue-int",
        payload: { itemId: 7, itemVersion: 3, milestone: "AUTO_CLOSE_168H" },
      },
    });
    expect(event.payload).toMatchObject({ itemId: 7, milestone: "AUTO_CLOSE_168H" });
    await expect(
      prisma.outboxEvent.create({
        data: {
          eventType: "AFTER_SALES_MILESTONE_REQUESTED",
          aggregateType: "ServiceRequestItem",
          aggregateId: 7,
          dedupeKey: "after-sales-queue-int",
          payload: {},
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
