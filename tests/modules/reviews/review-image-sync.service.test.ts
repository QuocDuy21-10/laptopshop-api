jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));
jest.mock("modules/reviews/review-images.processor", () => ({
  processReviewImage: jest.fn(async (file: Express.Multer.File) => ({
    buffer: file.buffer,
    mimeType: "image/webp" as const,
    byteSize: file.buffer.length,
    width: 100,
    height: 50,
  })),
}));

import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { installSyncTransaction } from "../../helpers/review-image-sync-transaction";
import { createReviewImageSyncFingerprint } from "modules/reviews/review-image-sync.fingerprint";
import {
  finalizeReviewImageSync,
  getReviewImageSyncStatus,
  syncReviewImages,
  type ReviewImageSyncDeps,
} from "modules/reviews/review-image-sync.service";
import type { ReviewImageSyncManifest } from "modules/reviews/review-image-sync.types";

const file = (value = "png") =>
  ({
    buffer: Buffer.from(value),
    mimetype: "image/png",
    size: value.length,
  }) as Express.Multer.File;

const manifest: ReviewImageSyncManifest = {
  expectedVersion: 0,
  items: [{ kind: "new", clientId: "new-image", fileIndex: 0 }],
};

const review = { id: 18, imageVersion: 0, deletedAt: null };
const pendingImage = {
  id: 21,
  reviewId: 18,
  objectKey: "reviews/18/sync/90/21.webp",
  syncOperationId: 90,
  syncClientId: "new-image",
  mimeType: "image/webp",
  byteSize: 3,
  width: 100,
  height: 50,
  position: 0,
  status: "PENDING" as const,
  deletedAt: null,
  storageDeletedAt: null,
  purgeAfter: null,
  createdAt: new Date("2026-10-21T01:00:00.000Z"),
  updatedAt: new Date("2026-10-21T01:00:00.000Z"),
};

const operation = (overrides: Record<string, unknown> = {}) => ({
  id: 90,
  userId: 7,
  reviewId: 18,
  idempotencyKey: "sync-key",
  requestFingerprint: createReviewImageSyncFingerprint(18, manifest, [file()]),
  expectedVersion: 0,
  status: "PROCESSING" as const,
  manifest: JSON.parse(JSON.stringify(manifest)),
  result: null,
  errorCode: null,
  errorDetails: null,
  leaseOwner: "lease",
  leaseExpiresAt: new Date("2026-10-21T01:02:00.000Z"),
  attemptCount: 1,
  createdAt: new Date("2026-10-21T01:00:00.000Z"),
  updatedAt: new Date("2026-10-21T01:00:00.000Z"),
  completedAt: null,
  expiresAt: null,
  ...overrides,
});

const deps = (): ReviewImageSyncDeps => ({
  storage: {
    putObject: jest.fn().mockResolvedValue(undefined),
    deleteObject: jest.fn().mockResolvedValue(undefined),
    objectExists: jest.fn().mockResolvedValue(true),
    getSignedReadUrl: jest.fn().mockResolvedValue("https://signed.example/image.webp"),
  },
  urlTtlSeconds: 60,
  now: () => new Date("2026-10-21T01:00:00.000Z"),
});

beforeEach(() => {
  resetPrisma();
  prismaMock.$queryRaw.mockResolvedValue([{ id: 18, imageVersion: 0, deletedAt: null }]);
  prismaMock.review.findFirst.mockResolvedValue(review);
  prismaMock.reviewImage.findMany.mockResolvedValue([]);
  prismaMock.reviewImageSyncOperation.findUnique.mockResolvedValue(null);
  prismaMock.reviewImageSyncOperation.create.mockResolvedValue(operation());
  prismaMock.reviewImage.create.mockResolvedValue(pendingImage);
  prismaMock.reviewImage.update.mockResolvedValue(pendingImage);
  prismaMock.reviewImage.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.reviewImageSyncOperation.update.mockImplementation(async ({ data }) =>
    operation(data),
  );
  prismaMock.reviewImageSyncOperation.updateMany.mockResolvedValue({ count: 1 });
});

describe("review image sync service", () => {
  it("rearms cleanup for an upload that completed after review deletion", async () => {
    const deletedAt = new Date();
    const store = installSyncTransaction({
      operation: operation(),
      images: [{ ...pendingImage, deletedAt, storageDeletedAt: deletedAt }],
      review: { ...review, deletedAt },
    });
    await expect(
      finalizeReviewImageSync(deps(), 7, operation(), [pendingImage], manifest, "lease"),
    ).rejects.toMatchObject({ code: "REVIEW_NOT_FOUND" });
    expect(store.committed.images[0]).toMatchObject({ status: "DELETING", storageDeletedAt: null });
  });
  it("commits reserve failure before rejecting and replays the terminal status", async () => {
    const store = installSyncTransaction({
      operation: operation(),
      images: [],
      review: { ...review, imageVersion: 2 },
    });
    prismaMock.reviewImageSyncOperation.findUnique.mockResolvedValueOnce(null);
    await expect(
      syncReviewImages(deps(), 7, 18, "sync-key", manifest, [file()]),
    ).rejects.toMatchObject({ code: "REVIEW_IMAGE_VERSION_CONFLICT" });
    expect(store.committed.operation).toMatchObject({
      status: "FAILED",
      errorCode: "REVIEW_IMAGE_VERSION_CONFLICT",
    });
    await expect(getReviewImageSyncStatus(deps(), 7, 18, "sync-key")).resolves.toMatchObject({
      status: "FAILED",
      error: { code: "REVIEW_IMAGE_VERSION_CONFLICT" },
    });
  });

  it.each(["version", "set", "deleted"])(
    "commits finalize %s failure and retires only its pending images",
    async (reason) => {
      const winner = { ...pendingImage, id: 22, syncOperationId: 91, status: "READY" as const };
      const store = installSyncTransaction({
        operation: operation(),
        images: [pendingImage, winner],
        review: {
          ...review,
          imageVersion: reason === "version" ? 1 : 0,
          deletedAt: reason === "deleted" ? new Date() : null,
        },
      });
      const desired =
        reason === "set"
          ? {
              expectedVersion: 0,
              items: [{ kind: "existing" as const, clientId: "missing", imageId: 99 }],
            }
          : manifest;
      await expect(
        finalizeReviewImageSync(deps(), 7, operation(), [pendingImage], desired, "lease"),
      ).rejects.toMatchObject({ status: reason === "deleted" ? 404 : 409 });
      expect(store.committed.operation?.status).toBe("FAILED");
      expect(store.committed.images[0].status).toBe("DELETING");
      expect(store.committed.images[1]).toEqual(winner);
    },
  );

  it("rolls back terminal state if reservation cleanup fails", async () => {
    const store = installSyncTransaction({
      operation: operation(),
      images: [pendingImage],
      review: { ...review, imageVersion: 1 },
    });
    prismaMock.reviewImage.updateMany.mockRejectedValueOnce(new Error("database write failed"));
    await expect(
      finalizeReviewImageSync(deps(), 7, operation(), [pendingImage], manifest, "lease"),
    ).rejects.toThrow("database write failed");
    expect(store.committed.operation?.status).toBe("PROCESSING");
    expect(store.committed.images[0].status).toBe("PENDING");
  });

  it("does not overwrite succeeded operation from an old upload lease", async () => {
    const runtime = deps();
    prismaMock.reviewImageSyncOperation.findUnique.mockResolvedValueOnce(null);
    const store = installSyncTransaction({
      operation: operation(),
      images: [pendingImage],
      review,
    });
    prismaMock.reviewImageSyncOperation.findUnique.mockResolvedValueOnce(null);
    runtime.storage.putObject = jest.fn(async () => {
      store.committed.operation!.status = "SUCCEEDED";
      store.committed.operation!.leaseOwner = null;
      throw new Error("old upload failed late");
    });
    await expect(
      syncReviewImages(runtime, 7, 18, "sync-key", manifest, [file()]),
    ).rejects.toBeDefined();
    expect(store.committed.operation?.status).toBe("SUCCEEDED");
  });
  it("reserves, uploads and returns one committed image set", async () => {
    const runtime = deps();
    prismaMock.reviewImageSyncOperation.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue(operation());
    prismaMock.reviewImage.findMany.mockResolvedValueOnce([]);

    const result = await syncReviewImages(runtime, 7, 18, "sync-key", manifest, [file()]);

    expect(runtime.storage.putObject).toHaveBeenCalledWith(
      expect.objectContaining({ key: pendingImage.objectKey, contentType: "image/webp" }),
    );
    expect(result).toMatchObject({ reviewId: 18, imageVersion: 1, replayed: false });
    expect(result.images[0]).toMatchObject({ id: 21, clientId: "new-image", position: 0 });
  });

  it("replays a successful operation with a newly signed URL and the same image identity", async () => {
    const runtime = deps();
    const snapshot = {
      reviewId: 18,
      imageVersion: 1,
      images: [{ ...pendingImage, clientId: "new-image", status: undefined }],
    };
    prismaMock.reviewImageSyncOperation.findUnique.mockResolvedValue(
      operation({ status: "SUCCEEDED", result: snapshot }),
    );

    const result = await syncReviewImages(runtime, 7, 18, "sync-key", manifest, [file()]);

    expect(result).toMatchObject({ replayed: true, imageVersion: 1 });
    expect(result.images[0]).toMatchObject({ id: 21, clientId: "new-image" });
    expect(runtime.storage.putObject).not.toHaveBeenCalled();
    expect(runtime.storage.getSignedReadUrl).toHaveBeenCalledWith(pendingImage.objectKey, 60);
  });

  it("rejects the same key when the fingerprint changes", async () => {
    prismaMock.reviewImageSyncOperation.findUnique.mockResolvedValue(
      operation({ requestFingerprint: "different-fingerprint" }),
    );

    await expect(
      syncReviewImages(deps(), 7, 18, "sync-key", manifest, [file()]),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
      status: 409,
    });
  });

  it("returns in-progress for a live lease without uploading", async () => {
    prismaMock.reviewImageSyncOperation.findUnique.mockResolvedValue(
      operation({ leaseExpiresAt: new Date("2026-10-21T01:01:00.000Z") }),
    );

    await expect(
      syncReviewImages(deps(), 7, 18, "sync-key", manifest, [file()]),
    ).rejects.toMatchObject({
      code: "REVIEW_IMAGE_SYNC_IN_PROGRESS",
      status: 409,
    });
  });

  it("marks an operation waiting for retry when storage upload fails", async () => {
    const runtime = deps();
    (runtime.storage.putObject as jest.Mock).mockRejectedValueOnce(new Error("storage down"));
    prismaMock.reviewImage.findMany.mockResolvedValueOnce([]);
    prismaMock.reviewImageSyncOperation.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue(operation());

    await expect(
      syncReviewImages(runtime, 7, 18, "sync-key", manifest, [file()]),
    ).rejects.toMatchObject({
      code: "REVIEW_IMAGE_STORAGE_UNAVAILABLE",
      status: 503,
    });
    expect(prismaMock.reviewImageSyncOperation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "WAITING_RETRY" }) }),
    );
  });

  it("persists a version conflict as a terminal replayable failure", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ id: 18, imageVersion: 2, deletedAt: null }]);

    await expect(
      syncReviewImages(deps(), 7, 18, "sync-key", manifest, [file()]),
    ).rejects.toMatchObject({
      code: "REVIEW_IMAGE_VERSION_CONFLICT",
      status: 409,
    });
    expect(prismaMock.reviewImageSyncOperation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }),
    );
  });

  it("rejects finalize from a stale lease owner", async () => {
    prismaMock.reviewImageSyncOperation.findUnique.mockResolvedValue(
      operation({ leaseOwner: "new-lease" }),
    );

    await expect(
      finalizeReviewImageSync(deps(), 7, operation(), [pendingImage], manifest, "old-lease"),
    ).rejects.toMatchObject({ code: "REVIEW_IMAGE_SYNC_LEASE_LOST", status: 409 });
  });

  it("returns a status resource for an existing operation", async () => {
    prismaMock.reviewImageSyncOperation.findUnique.mockResolvedValue(
      operation({ status: "WAITING_RETRY" }),
    );
    await expect(getReviewImageSyncStatus(deps(), 7, 18, "sync-key")).resolves.toMatchObject({
      reviewId: 18,
      status: "WAITING_RETRY",
      retryable: true,
    });
  });
});
