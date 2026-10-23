jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import { prismaMock, resetPrisma } from "../../helpers/prisma";
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
  });
});
