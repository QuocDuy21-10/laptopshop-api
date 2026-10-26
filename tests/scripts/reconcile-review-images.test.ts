jest.mock("config/client", () => ({ prisma: require("../helpers/prisma").prismaMock }));

import { prismaMock, resetPrisma } from "../helpers/prisma";
import {
  reconcileReviewImageSyncOperations,
  reconcileReviewImages,
} from "scripts/reconcile-review-images";

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
  purgeAfter: null,
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

  it("does not delete a DELETING object before purgeAfter", async () => {
    const deps = storage();
    const future = new Date("2026-10-22T00:00:00.000Z");
    prismaMock.reviewImage.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row({ status: "DELETING", purgeAfter: future })])
      .mockResolvedValueOnce([]);

    await reconcileReviewImages({ storage: deps }, new Date("2026-10-21T00:00:00.000Z"));

    expect(deps.deleteObject).not.toHaveBeenCalled();
  });

  it("skips a sync operation while another lease is active", async () => {
    const deps = storage();
    prismaMock.reviewImageSyncOperation.findMany.mockResolvedValue([
      {
        id: 90,
        userId: 7,
        reviewId: 18,
        status: "PROCESSING",
        leaseOwner: "worker-a",
        leaseExpiresAt: new Date("2026-10-21T00:05:00.000Z"),
        updatedAt: new Date("2026-10-21T00:00:00.000Z"),
        createdAt: new Date("2026-10-21T00:00:00.000Z"),
        expectedVersion: 0,
        manifest: { expectedVersion: 0, items: [] },
      },
    ]);

    const result = await reconcileReviewImageSyncOperations(
      { storage: deps },
      new Date("2026-10-21T00:01:00.000Z"),
    );

    expect(result.skipped).toBe(1);
    expect(prismaMock.reviewImageSyncOperation.update).not.toHaveBeenCalled();
  });

  it("expires an incomplete retry operation and retires its reservations", async () => {
    const deps = storage();
    const old = new Date("2026-10-20T00:00:00.000Z");
    prismaMock.reviewImageSyncOperation.findMany.mockResolvedValue([
      {
        id: 90,
        userId: 7,
        reviewId: 18,
        status: "WAITING_RETRY",
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: old,
        createdAt: old,
        expectedVersion: 0,
        manifest: { expectedVersion: 0, items: [{ kind: "new", clientId: "x", fileIndex: 0 }] },
      },
    ]);
    prismaMock.reviewImage.findMany.mockResolvedValue([
      row({ status: "PENDING", syncOperationId: 90, syncClientId: "x" }),
    ]);
    deps.objectExists.mockResolvedValue(false);

    await reconcileReviewImageSyncOperations(
      { storage: deps },
      new Date("2026-10-21T02:00:00.000Z"),
    );

    expect(prismaMock.reviewImageSyncOperation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }),
    );
    expect(prismaMock.reviewImage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "DELETING" }) }),
    );
  });
});
