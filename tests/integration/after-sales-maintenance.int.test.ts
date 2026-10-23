import { prisma } from "config/client";
import {
  processAfterSalesMilestone,
  scheduleConfirmationMilestones,
} from "modules/after-sales/after-sales-maintenance";
import { createServiceRequest } from "modules/after-sales/after-sales.service";
import { createCompletedOrderItem, createProduct, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("after-sales maintenance integration", () => {
  it("persists three confirmation milestone outbox events", async () => {
    const user = await createUser();
    const detail = await createCompletedOrderItem(user.id, (await createProduct(1)).id);
    const request = await createServiceRequest(user.id, "maintenance-int", {
      type: "TECHNICAL_SUPPORT",
      subject: "M",
      items: [{ orderDetailId: detail.id, deviceLabel: "Máy", issueDescription: "Lỗi" }],
    });
    const itemId = request.request.items[0].id;
    const returnedAt = new Date("2026-10-23T10:00:00.000Z");
    await prisma.serviceRequestItem.update({
      where: { id: itemId },
      data: {
        status: "RETURNED",
        version: 4,
        returnedAt,
        confirmationDueAt: new Date("2026-10-30T10:00:00.000Z"),
      },
    });
    await prisma.$transaction((tx) =>
      scheduleConfirmationMilestones(tx, { id: itemId, version: 4, returnedAt, resolvedAt: null }),
    );
    expect(
      await prisma.outboxEvent.count({
        where: { aggregateId: itemId, eventType: "AFTER_SALES_MILESTONE_REQUESTED" },
      }),
    ).toBe(3);
  });

  it("auto-closes a due returned item once", async () => {
    const user = await createUser();
    const detail = await createCompletedOrderItem(user.id, (await createProduct(1)).id);
    const request = await createServiceRequest(user.id, "maintenance-close", {
      type: "TECHNICAL_SUPPORT",
      subject: "M",
      items: [{ orderDetailId: detail.id, deviceLabel: "Máy", issueDescription: "Lỗi" }],
    });
    const itemId = request.request.items[0].id;
    await prisma.serviceRequestItem.update({
      where: { id: itemId },
      data: {
        status: "RETURNED",
        version: 2,
        returnedAt: new Date("2026-10-23T10:00:00.000Z"),
        confirmationDueAt: new Date("2026-10-30T10:00:00.000Z"),
      },
    });
    await expect(
      processAfterSalesMilestone(
        { itemId, itemVersion: 2, milestone: "AUTO_CLOSE_168H" },
        new Date("2026-10-30T10:00:00.000Z"),
      ),
    ).resolves.toBe("closed");
    await expect(
      processAfterSalesMilestone(
        { itemId, itemVersion: 2, milestone: "AUTO_CLOSE_168H" },
        new Date("2026-10-30T10:00:00.000Z"),
      ),
    ).resolves.toBe("noop");
  });
});
