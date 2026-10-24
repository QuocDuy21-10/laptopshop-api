jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));
jest.mock("modules/after-sales/after-sales.notifications", () => ({
  createAfterSalesNotification: jest.fn().mockResolvedValue(undefined),
}));

import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { createAfterSalesNotification } from "modules/after-sales/after-sales.notifications";
import {
  processAfterSalesMilestone,
  scheduleConfirmationMilestones,
} from "modules/after-sales/after-sales-maintenance";

beforeEach(resetPrisma);

describe("after-sales maintenance", () => {
  it("schedules exact 72, 144, and 168 hour milestones", async () => {
    const create = prismaMock.outboxEvent.create;
    await scheduleConfirmationMilestones(prismaMock, {
      id: 7,
      version: 3,
      returnedAt: new Date("2026-10-23T10:00:00.000Z"),
      resolvedAt: null,
    });
    expect(create.mock.calls.map((call) => call[0].data.availableAt.toISOString())).toEqual([
      "2026-10-26T10:00:00.000Z",
      "2026-10-29T10:00:00.000Z",
      "2026-10-30T10:00:00.000Z",
    ]);
  });

  it("closes a due item once and no-ops on a repeated job", async () => {
    prismaMock.serviceRequestItem.findUnique.mockResolvedValue({
      id: 7,
      serviceRequestId: 9,
      version: 3,
      status: "RETURNED",
      confirmationDueAt: new Date("2026-10-30T10:00:00.000Z"),
      request: { userId: 11, assignedToId: 2 },
    });
    prismaMock.serviceRequestItem.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    prismaMock.serviceRequestItem.findMany.mockResolvedValue([{ status: "CLOSED" }]);
    prismaMock.serviceRequest.update.mockResolvedValue({});
    const due = new Date("2026-10-30T10:00:00.000Z");
    expect(
      await processAfterSalesMilestone(
        { itemId: 7, itemVersion: 3, milestone: "AUTO_CLOSE_168H" },
        due,
      ),
    ).toBe("closed");
    expect(
      await processAfterSalesMilestone(
        { itemId: 7, itemVersion: 3, milestone: "AUTO_CLOSE_168H" },
        due,
      ),
    ).toBe("noop");
    expect(createAfterSalesNotification).toHaveBeenCalled();
    expect((createAfterSalesNotification as jest.Mock).mock.calls[0][1]).toEqual(
      expect.objectContaining({ event: "ADMIN_STATUS", type: "AFTER_SALES_AUTO_CLOSED" }),
    );
  });

  it.each(["REMIND_72H", "REMIND_144H"] as const)(
    "creates a deduplicated reminder for %s",
    async (milestone) => {
      prismaMock.serviceRequestItem.findUnique.mockResolvedValue({
        id: 7,
        serviceRequestId: 9,
        version: 3,
        status: "RETURNED",
        confirmationDueAt: new Date("2026-10-30T10:00:00.000Z"),
        request: { userId: 11, assignedToId: 2 },
      });
      const result = await processAfterSalesMilestone(
        { itemId: 7, itemVersion: 3, milestone },
        new Date(
          milestone === "REMIND_72H" ? "2026-10-26T10:00:00.000Z" : "2026-10-29T10:00:00.000Z",
        ),
      );
      expect(result).toBe("reminded");
      expect(createAfterSalesNotification).toHaveBeenCalled();
      expect((createAfterSalesNotification as jest.Mock).mock.calls.at(-1)?.[1]).toEqual(
        expect.objectContaining({
          event: "CONFIRMATION_REQUIRED",
          type: "AFTER_SALES_CONFIRMATION_REQUIRED",
          dedupeKey: `after-sales-confirmation:7:3:${milestone}`,
        }),
      );
    },
  );
});
