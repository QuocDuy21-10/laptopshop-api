jest.mock("config/client", () => ({ prisma: require("../helpers/prisma").prismaMock }));

import { prismaMock, resetPrisma } from "../helpers/prisma";
import { reconcileReviewImages } from "scripts/reconcile-review-images";

const storage = () => ({
  putObject: jest.fn(),
  deleteObject: jest.fn().mockResolvedValue(undefined),
  objectExists: jest.fn().mockResolvedValue(true),
  getSignedReadUrl: jest.fn(),
});

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 21,
  objectKey: "reviews/18/21.webp",
  updatedAt: new Date("2026-10-20T00:00:00.000Z"),
  status: "PENDING" as const,
  storageDeletedAt: null,
  ...overrides,
});

beforeEach(resetPrisma);

describe("reconcileReviewImages", () => {
  it("cleans stale pending rows and retryable deleting rows", async () => {
    const deps = storage();
    prismaMock.reviewImage.findMany
      .mockResolvedValueOnce([row()])
      .mockResolvedValueOnce([row({ status: "DELETING" })])
      .mockResolvedValueOnce([]);
    prismaMock.reviewImage.update.mockResolvedValue({ id: 21 });

    await expect(
      reconcileReviewImages({ storage: deps }, new Date("2026-10-21T00:00:00.000Z")),
    ).resolves.toMatchObject({
      pending: 1,
      deleting: 1,
      missingReady: [],
      errors: 0,
    });
    expect(deps.deleteObject).toHaveBeenCalledTimes(2);
    expect(prismaMock.reviewImage.update).toHaveBeenCalled();
  });

  it("reports a missing ready object without silently changing the database", async () => {
    const deps = storage();
    deps.objectExists.mockResolvedValue(false);
    prismaMock.reviewImage.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row({ status: "READY" })]);

    await expect(reconcileReviewImages({ storage: deps }, new Date())).resolves.toMatchObject({
      missingReady: [21],
      errors: 0,
    });
    expect(prismaMock.reviewImage.update).not.toHaveBeenCalled();
  });

  it("counts operational storage errors and remains safe to rerun", async () => {
    const deps = storage();
    deps.deleteObject.mockRejectedValueOnce(new Error("temporary storage failure"));
    prismaMock.reviewImage.findMany.mockResolvedValueOnce([row()]).mockResolvedValue([]);

    await expect(reconcileReviewImages({ storage: deps }, new Date())).resolves.toMatchObject({
      pending: 0,
      errors: 1,
    });
    expect(prismaMock.reviewImage.update).not.toHaveBeenCalled();
  });
});
