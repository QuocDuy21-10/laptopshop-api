jest.mock("config/client", () => ({ prisma: require("../helpers/prisma").prismaMock }));

import { prismaMock, resetPrisma } from "../helpers/prisma";
import { reconcileAfterSalesAttachments } from "modules/after-sales/after-sales-attachment-cleanup";

beforeEach(resetPrisma);

describe("reconcile after-sales attachments", () => {
  it("tombstones stale pending rows and cleans the bounded batch", async () => {
    prismaMock.serviceRequestAttachment.updateMany.mockResolvedValue({ count: 2 });
    prismaMock.serviceRequestAttachment.findMany.mockResolvedValue([{ id: 7 }]);
    prismaMock.serviceRequestAttachment.findUnique.mockResolvedValue({
      id: 7,
      objectKey: "after-sales/7/8/stale.webp",
      status: "DELETING",
      storageDeletedAt: null,
    });
    prismaMock.serviceRequestAttachment.updateMany
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 1 });
    const result = await reconcileAfterSalesAttachments(
      { storage: { deleteObject: jest.fn().mockResolvedValue(undefined) } as never },
      { now: new Date("2026-10-23T00:00:00.000Z"), limit: 1, pendingTtlMs: 3_600_000 },
    );
    expect(result).toEqual({ deleted: 1, tombstoned: 2, failed: 0 });
  });
});
