jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { deleteMyReview } from "modules/reviews/reviews.service";

it("does not let a delayed storage DELETE acknowledgement retire a later sync upload", async () => {
  resetPrisma();
  const pending = {
    id: 21,
    objectKey: "pending",
    status: "PENDING",
    syncOperationId: 90,
    deletedAt: null as Date | null,
    storageDeletedAt: null as Date | null,
  };
  const ready = { ...pending, id: 22, objectKey: "ready", status: "READY", syncOperationId: 91 };
  const rows = [pending, ready];
  const objects = new Set(["ready"]);
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const acknowledgement = new Promise<void>((resolve) => {
    release = resolve;
  });
  prismaMock.$queryRaw.mockResolvedValue([{ id: 18, deletedAt: null }]);
  prismaMock.reviewImage.findMany.mockImplementation(async () => rows.map((row) => ({ ...row })));
  prismaMock.reviewImage.updateMany.mockImplementation(async ({ where, data }) => {
    for (const row of rows) if (row.status === where.status) Object.assign(row, data);
    return { count: 1 };
  });
  prismaMock.reviewImage.update.mockImplementation(async ({ where, data }) => {
    const row = rows.find((item) => item.id === where.id)!;
    Object.assign(row, data);
    return row;
  });
  const storage = {
    putObject: jest.fn(),
    objectExists: jest.fn(),
    getSignedReadUrl: jest.fn(),
    deleteObject: jest.fn(async (key: string) => {
      objects.delete(key);
      if (key === "pending") {
        entered();
        await acknowledgement;
      }
    }),
  };
  const deleting = deleteMyReview(7, 18, { storage });
  await Promise.race([started, deleting]);
  // PUT commits, and finalize retires its reservation while the earlier DELETE response waits.
  objects.add("pending");
  pending.status = "DELETING";
  pending.storageDeletedAt = null;
  release();
  await deleting;
  expect(objects.has("ready")).toBe(false);
  expect(objects.has("pending")).toBe(true);
  expect(pending.storageDeletedAt).toBeNull();
});
