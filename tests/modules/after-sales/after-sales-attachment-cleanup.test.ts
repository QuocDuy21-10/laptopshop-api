jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { cleanupServiceAttachment } from "modules/after-sales/after-sales-attachment-cleanup";

beforeEach(resetPrisma);

describe("after-sales attachment cleanup", () => {
  it("treats a missing object as an idempotent deletion", async () => {
    prismaMock.serviceRequestAttachment.findUnique.mockResolvedValue({
      id: 7,
      objectKey: "after-sales/7/8/object.webp",
      status: "DELETING",
      storageDeletedAt: null,
    });
    const storage = { deleteObject: jest.fn().mockResolvedValue(undefined) };
    prismaMock.serviceRequestAttachment.updateMany.mockResolvedValue({ count: 1 });
    await expect(cleanupServiceAttachment({ storage: storage as never }, 7)).resolves.toBe(
      "deleted",
    );
    expect(storage.deleteObject).toHaveBeenCalledWith("after-sales/7/8/object.webp");
    expect(prismaMock.serviceRequestAttachment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ storageDeletedAt: expect.any(Date) }),
      }),
    );
  });
});
