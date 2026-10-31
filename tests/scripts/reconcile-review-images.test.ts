jest.mock("config/client", () => ({ prisma: require("../helpers/prisma").prismaMock }));

import { prismaMock, resetPrisma } from "../helpers/prisma";
import { installSyncTransaction } from "../helpers/review-image-sync-transaction";
import type { ReviewImageSyncOperation } from "@prisma/client";
import type { ReviewImageRow } from "modules/reviews/review-images.mapper";
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

const syncFixture = (overrides: Partial<ReviewImageSyncOperation> = {}) => {
  const now = new Date("2026-10-21T02:00:00Z");
  const operation: ReviewImageSyncOperation = {
    id: 90,
    userId: 7,
    reviewId: 18,
    idempotencyKey: "sync",
    requestFingerprint: "a".repeat(64),
    expectedVersion: 0,
    status: "WAITING_RETRY",
    leaseOwner: null,
    leaseExpiresAt: null,
    manifest: { expectedVersion: 0, items: [{ kind: "new", clientId: "x", fileIndex: 0 }] },
    result: null,
    errorCode: null,
    errorDetails: null,
    attemptCount: 1,
    createdAt: new Date("2026-10-21T00:00:00Z"),
    updatedAt: now,
    completedAt: null,
    expiresAt: null,
    ...overrides,
  };
  const image: ReviewImageRow = {
    ...row(),
    objectKey: "reviews/18/sync/90/21.webp",
    syncOperationId: 90,
    syncClientId: "x",
    mimeType: "image/webp",
    byteSize: 5,
    width: 10,
    height: 10,
    position: 0,
    deletedAt: null,
    createdAt: operation.createdAt,
  };
  const store = installSyncTransaction({
    operation,
    images: [image],
    review: { id: 18, imageVersion: 0, deletedAt: null },
  });
  prismaMock.reviewImageSyncOperation.findMany.mockResolvedValue([operation]);
  return { store, operation, image, now };
};

describe("reconcileReviewImages", () => {
  it("allows only one claimant while another worker checks storage", async () => {
    const { store, now } = syncFixture({ createdAt: new Date("2026-10-21T01:59:00Z") });
    let release!: (value: boolean) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const deps = storage();
    deps.objectExists.mockImplementation(async () => {
      entered();
      return blocked;
    });
    const first = reconcileReviewImageSyncOperations({ storage: deps }, now);
    await started;
    const second = await reconcileReviewImageSyncOperations({ storage: deps }, now);
    expect(second.skipped).toBe(1);
    release(false);
    await first;
    expect(store.committed.operation?.status).toBe("WAITING_RETRY");
    expect(deps.objectExists).toHaveBeenCalledTimes(1);
  });

  it("terminalizes a deleted review without checking storage", async () => {
    const { store, now } = syncFixture({ createdAt: new Date("2026-10-21T01:59:00Z") });
    store.committed.review.deletedAt = now;
    const deps = storage();
    await reconcileReviewImageSyncOperations({ storage: deps }, now);
    expect(store.committed.operation).toMatchObject({
      status: "FAILED",
      errorCode: "REVIEW_NOT_FOUND",
    });
    expect(deps.objectExists).not.toHaveBeenCalled();
  });

  it("counts a storage check exception without inventing a terminal result", async () => {
    const { store, now } = syncFixture({ createdAt: new Date("2026-10-21T01:59:00Z") });
    const deps = storage();
    deps.objectExists.mockRejectedValue(new Error("storage unavailable"));
    const result = await reconcileReviewImageSyncOperations({ storage: deps }, now);
    expect(result.errors).toBe(1);
    expect(store.committed.operation?.status).toBe("PROCESSING");
  });
  it("expires by original creation time even after waiting updates", async () => {
    const { store, now } = syncFixture();
    const deps = storage();
    deps.objectExists.mockResolvedValue(false);
    await reconcileReviewImageSyncOperations({ storage: deps }, now);
    expect(store.committed.operation).toMatchObject({ status: "FAILED", leaseOwner: null });
    expect(store.committed.images[0].status).toBe("DELETING");
  });

  it("fails an incomplete manifest instead of finalizing an empty reservation set", async () => {
    const { store, now } = syncFixture({ createdAt: new Date("2026-10-21T01:59:00Z") });
    store.committed.images = [];
    await reconcileReviewImageSyncOperations({ storage: storage() }, now);
    expect(store.committed.operation).toMatchObject({
      status: "FAILED",
      errorCode: "REVIEW_IMAGE_SYNC_FAILED",
    });
  });

  it("does not mutate an operation after losing its claim during storage checks", async () => {
    const { store, now } = syncFixture({ createdAt: new Date("2026-10-21T01:59:00Z") });
    const deps = storage();
    deps.objectExists.mockImplementation(async () => {
      store.committed.operation!.status = "SUCCEEDED";
      store.committed.operation!.leaseOwner = null;
      return false;
    });
    await reconcileReviewImageSyncOperations({ storage: deps }, now);
    expect(store.committed.operation?.status).toBe("SUCCEEDED");
    expect(store.committed.images[0].status).toBe("PENDING");
  });

  it("commits a finalize version conflict and leaves the winning version unchanged", async () => {
    const { store, now } = syncFixture({ createdAt: new Date("2026-10-21T01:59:00Z") });
    store.committed.review.imageVersion = 1;
    await reconcileReviewImageSyncOperations({ storage: storage() }, now);
    expect(store.committed.operation).toMatchObject({
      status: "FAILED",
      errorCode: "REVIEW_IMAGE_VERSION_CONFLICT",
    });
    expect(store.committed.review.imageVersion).toBe(1);
  });
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
    const { store, now } = syncFixture();
    const deps = storage();
    deps.objectExists.mockResolvedValue(false);
    await reconcileReviewImageSyncOperations({ storage: deps }, now);
    expect(store.committed.operation?.status).toBe("FAILED");
    expect(store.committed.images[0].status).toBe("DELETING");
  });
});
