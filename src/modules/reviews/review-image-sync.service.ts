import { Prisma, type ReviewImageSyncOperation } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { env } from "config/env";
import { prisma } from "config/client";
import { AppError, isUniqueViolation } from "lib/errors";
import { createReviewImageSyncFingerprint } from "modules/reviews/review-image-sync.fingerprint";
import {
  snapshotFromJson,
  type ReviewImageSyncResultDto,
  type ReviewImageSyncSnapshot,
  type ReviewImageSyncSnapshotImage,
  type ReviewImageSyncStatusDto,
} from "modules/reviews/review-image-sync.mapper";
import {
  activeReviewImages,
  findSyncOperation,
  lockOwnedReviewForSync,
  type ReviewImageSyncClient,
} from "modules/reviews/review-image-sync.repository";
import {
  processReviewImage,
  type ProcessedReviewImage,
} from "modules/reviews/review-images.processor";
import { reviewImageNow, reviewImageTtl } from "modules/reviews/review-image-runtime";
import type { ReviewImageDeps } from "modules/reviews/review-images.service";
import type { ReviewImageRow } from "modules/reviews/review-images.mapper";
import { reviewImageSelect } from "modules/reviews/review-images.mapper";
import type {
  ReviewImageSyncItem,
  ReviewImageSyncManifest,
} from "modules/reviews/review-image-sync.types";

export type ReviewImageSyncDeps = ReviewImageDeps;

type ReservedImage = ReviewImageRow & {
  syncClientId: string | null;
  syncOperationId: number | null;
};

const inProgress = () =>
  new AppError("Review image sync is already in progress", 409, "REVIEW_IMAGE_SYNC_IN_PROGRESS");
const versionConflict = (expectedVersion: number, currentVersion: number) =>
  new AppError("Review image version has changed", 409, "REVIEW_IMAGE_VERSION_CONFLICT", {
    expectedVersion,
    currentVersion,
  });
const notFound = () => new AppError("Review not found", 404, "REVIEW_NOT_FOUND");
const idempotencyConflict = () =>
  new AppError(
    "Idempotency key was reused with a different request",
    409,
    "IDEMPOTENCY_KEY_REUSED",
  );
const setConflict = () =>
  new AppError("Review image set has changed", 409, "REVIEW_IMAGE_SET_CHANGED");
const storageUnavailable = () =>
  new AppError("Review image storage is unavailable", 503, "REVIEW_IMAGE_STORAGE_UNAVAILABLE");

const errorDetails = (error: AppError) => ({
  status: error.status,
  message: error.message,
  details: (error.details ?? null) as Prisma.InputJsonValue,
});

const replayFailure = (operation: ReviewImageSyncOperation): never => {
  const details = (operation.errorDetails ?? {}) as {
    status?: number;
    message?: string;
    details?: unknown;
  };
  throw new AppError(
    details.message ?? "Review image sync failed",
    details.status ?? 409,
    operation.errorCode ?? "REVIEW_IMAGE_SYNC_FAILED",
    details.details,
  );
};

const sameIds = (left: number[], right: number[]) =>
  left.length === right.length && left.every((id, index) => id === right[index]);

const manifestExistingIds = (manifest: ReviewImageSyncManifest) =>
  manifest.items.flatMap((item) => (item.kind === "existing" ? [item.imageId] : []));

const manifestNewItems = (manifest: ReviewImageSyncManifest) =>
  manifest.items.filter(
    (item): item is Extract<ReviewImageSyncItem, { kind: "new" }> => item.kind === "new",
  );

const reservationData = (
  processed: ProcessedReviewImage,
  reviewId: number,
  operationId: number,
  clientId: string,
  position: number,
) => ({
  reviewId,
  syncOperationId: operationId,
  syncClientId: clientId,
  objectKey: `reviews/${reviewId}/sync/${operationId}/${randomUUID()}.webp`,
  mimeType: processed.mimeType,
  byteSize: processed.byteSize,
  width: processed.width,
  height: processed.height,
  position,
  status: "PENDING" as const,
});

const snapshotImage = (image: ReviewImageRow, clientId: string): ReviewImageSyncSnapshotImage => ({
  clientId,
  id: image.id,
  objectKey: image.objectKey,
  mimeType: image.mimeType,
  width: image.width,
  height: image.height,
  position: image.position,
});

const signSnapshot = async (
  deps: ReviewImageSyncDeps,
  snapshot: ReviewImageSyncSnapshot,
  replayed: boolean,
): Promise<ReviewImageSyncResultDto> => {
  const now = reviewImageNow(deps);
  const ttl = reviewImageTtl(deps, env.REVIEW_IMAGE_URL_TTL_SECONDS);
  const images = await Promise.all(
    snapshot.images.map(async (image) => ({
      clientId: image.clientId,
      id: image.id,
      url: await deps.storage.getSignedReadUrl(image.objectKey, ttl),
      urlExpiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
      mimeType: image.mimeType as "image/webp",
      width: image.width,
      height: image.height,
      position: image.position,
    })),
  );
  return { ...snapshot, replayed, images };
};

const markOperationFailure = async (
  tx: ReviewImageSyncClient,
  operationId: number,
  error: AppError,
  now: Date,
) => {
  await tx.reviewImageSyncOperation.update({
    where: { id: operationId },
    data: {
      status: "FAILED",
      errorCode: error.code,
      errorDetails: errorDetails(error),
      leaseOwner: null,
      leaseExpiresAt: null,
      completedAt: now,
      expiresAt: new Date(now.getTime() + env.REVIEW_IMAGE_IDEMPOTENCY_RETENTION_MS),
    },
  });
};

const reserveOperation = async (
  deps: ReviewImageSyncDeps,
  userId: number,
  reviewId: number,
  idempotencyKey: string,
  manifest: ReviewImageSyncManifest,
  fingerprint: string,
  processed: ProcessedReviewImage[],
) => {
  const now = reviewImageNow(deps);
  const leaseOwner = randomUUID();
  return prisma.$transaction(async (tx) => {
    const locked = await lockOwnedReviewForSync(tx, userId, reviewId);
    if (!locked) throw notFound();

    let operation = await tx.reviewImageSyncOperation.findUnique({
      where: { userId_reviewId_idempotencyKey: { userId, reviewId, idempotencyKey } },
    });
    if (operation) {
      if (operation.requestFingerprint !== fingerprint) throw idempotencyConflict();
      if (operation.status === "SUCCEEDED")
        return { operation, rows: [] as ReservedImage[], replay: true };
      if (operation.status === "FAILED") replayFailure(operation);
      if (
        operation.status === "PROCESSING" &&
        operation.leaseExpiresAt &&
        operation.leaseExpiresAt > now
      )
        throw inProgress();
      operation = await tx.reviewImageSyncOperation.update({
        where: { id: operation.id },
        data: {
          status: "PROCESSING",
          leaseOwner,
          leaseExpiresAt: new Date(now.getTime() + env.REVIEW_IMAGE_SYNC_LEASE_MS),
          attemptCount: { increment: 1 },
        },
      });
      const rows = (await tx.reviewImage.findMany({
        where: {
          syncOperationId: operation.id,
          status: { in: ["PENDING", "READY"] },
          deletedAt: null,
        },
        select: reviewImageSelect,
      })) as ReservedImage[];
      return { operation, rows, replay: false, leaseOwner: operation.leaseOwner ?? leaseOwner };
    } else {
      operation = await tx.reviewImageSyncOperation.create({
        data: {
          userId,
          reviewId,
          idempotencyKey,
          requestFingerprint: fingerprint,
          expectedVersion: manifest.expectedVersion,
          status: "PROCESSING",
          manifest: JSON.parse(JSON.stringify(manifest)) as Prisma.InputJsonValue,
          leaseOwner,
          leaseExpiresAt: new Date(now.getTime() + env.REVIEW_IMAGE_SYNC_LEASE_MS),
          attemptCount: 1,
        },
      });
    }

    if (locked.imageVersion !== manifest.expectedVersion) {
      const error = versionConflict(manifest.expectedVersion, locked.imageVersion);
      await markOperationFailure(tx, operation.id, error, now);
      throw error;
    }

    const active = await activeReviewImages(tx, reviewId);
    const existingIds = manifestExistingIds(manifest);
    if (existingIds.some((id) => !active.some((image) => image.id === id))) {
      const error = setConflict();
      await markOperationFailure(tx, operation.id, error, now);
      throw error;
    }

    const rows: ReservedImage[] = [];
    for (const item of manifestNewItems(manifest)) {
      const existingReservation = await tx.reviewImage.findFirst({
        where: { syncOperationId: operation.id, syncClientId: item.clientId, deletedAt: null },
        select: reviewImageSelect,
      });
      if (existingReservation) {
        rows.push(existingReservation as ReservedImage);
        continue;
      }
      const created = await tx.reviewImage.create({
        data: reservationData(
          processed[item.fileIndex],
          reviewId,
          operation.id,
          item.clientId,
          manifest.items.indexOf(item),
        ),
        select: reviewImageSelect,
      });
      rows.push(created as ReservedImage);
    }
    return { operation, rows, replay: false, leaseOwner: operation.leaseOwner ?? leaseOwner };
  });
};

export const finalizeReviewImageSync = async (
  deps: ReviewImageSyncDeps,
  userId: number,
  operation: ReviewImageSyncOperation,
  reservations: ReservedImage[],
  manifest: ReviewImageSyncManifest,
  leaseOwner: string,
): Promise<ReviewImageSyncSnapshot> => {
  const now = reviewImageNow(deps);
  return prisma.$transaction(async (tx) => {
    const currentOperation = await tx.reviewImageSyncOperation.findUnique({
      where: { id: operation.id },
    });
    if (!currentOperation || currentOperation.leaseOwner !== leaseOwner)
      throw new AppError("Review image sync lease was lost", 409, "REVIEW_IMAGE_SYNC_LEASE_LOST");
    const locked = await lockOwnedReviewForSync(tx, userId, operation.reviewId);
    if (!locked) throw notFound();
    if (locked.imageVersion !== manifest.expectedVersion) {
      const error = versionConflict(manifest.expectedVersion, locked.imageVersion);
      await markOperationFailure(tx, operation.id, error, now);
      await tx.reviewImage.updateMany({
        where: { syncOperationId: operation.id, status: "PENDING" },
        data: {
          status: "DELETING",
          deletedAt: now,
          purgeAfter: new Date(now.getTime() + env.REVIEW_IMAGE_IDEMPOTENCY_RETENTION_MS),
        },
      });
      throw error;
    }

    const active = await activeReviewImages(tx, operation.reviewId);
    const existingIds = manifestExistingIds(manifest);
    if (existingIds.some((id) => !active.some((image) => image.id === id))) {
      const error = setConflict();
      await markOperationFailure(tx, operation.id, error, now);
      throw error;
    }

    const reservationsByClient = new Map(
      reservations.flatMap((row) => (row.syncClientId ? [[row.syncClientId, row] as const] : [])),
    );
    const activeById = new Map(active.map((row) => [row.id, row]));
    const desired = manifest.items.map((item) =>
      item.kind === "existing"
        ? activeById.get(item.imageId)!
        : reservationsByClient.get(item.clientId)!,
    );
    const currentIds = active.map((row) => row.id);
    const desiredIds = desired.map((row) => row.id);
    const changed = !sameIds(currentIds, desiredIds);

    if (reservations.length) {
      await tx.reviewImage.updateMany({
        where: {
          id: { in: reservations.map((row) => row.id) },
          status: "PENDING",
          deletedAt: null,
        },
        data: { status: "READY" },
      });
    }
    const removedIds = currentIds.filter((id) => !desiredIds.includes(id));
    if (removedIds.length) {
      await tx.reviewImage.updateMany({
        where: { id: { in: removedIds }, status: "READY", deletedAt: null },
        data: {
          status: "DELETING",
          deletedAt: now,
          purgeAfter: new Date(now.getTime() + env.REVIEW_IMAGE_IDEMPOTENCY_RETENTION_MS),
        },
      });
    }
    await Promise.all(
      desired.map((row, position) =>
        tx.reviewImage.update({
          where: { id: row.id },
          data: { position },
          select: reviewImageSelect,
        }),
      ),
    );
    const nextVersion = changed ? locked.imageVersion + 1 : locked.imageVersion;
    if (changed)
      await tx.review.update({
        where: { id: operation.reviewId },
        data: { imageVersion: nextVersion },
      });
    const snapshot: ReviewImageSyncSnapshot = {
      reviewId: operation.reviewId,
      imageVersion: nextVersion,
      images: desired.map((row, position) =>
        snapshotImage({ ...row, position }, manifest.items[position].clientId),
      ),
    };
    await tx.reviewImageSyncOperation.update({
      where: { id: operation.id },
      data: {
        status: "SUCCEEDED",
        result: snapshot as unknown as Prisma.InputJsonValue,
        leaseOwner: null,
        leaseExpiresAt: null,
        completedAt: now,
        expiresAt: new Date(now.getTime() + env.REVIEW_IMAGE_IDEMPOTENCY_RETENTION_MS),
      },
    });
    return snapshot;
  });
};

export const syncReviewImages = async (
  deps: ReviewImageSyncDeps,
  userId: number,
  reviewId: number,
  idempotencyKey: string,
  manifest: ReviewImageSyncManifest,
  files: Express.Multer.File[],
): Promise<ReviewImageSyncResultDto> => {
  const processed = await Promise.all(files.map(processReviewImage));
  const fingerprint = createReviewImageSyncFingerprint(reviewId, manifest, files);
  const reservation = await reserveOperation(
    deps,
    userId,
    reviewId,
    idempotencyKey,
    manifest,
    fingerprint,
    processed,
  );
  if (reservation.replay) {
    const snapshot = snapshotFromJson(reservation.operation.result);
    return signSnapshot(deps, snapshot, true);
  }
  if (reservation.rows.length) {
    try {
      await Promise.all(
        reservation.rows.map((row) => {
          const item = manifest.items.find(
            (candidate) => candidate.kind === "new" && candidate.clientId === row.syncClientId,
          ) as Extract<ReviewImageSyncItem, { kind: "new" }>;
          return deps.storage.putObject({
            key: row.objectKey,
            body: processed[item.fileIndex].buffer,
            contentLength: processed[item.fileIndex].byteSize,
            contentType: processed[item.fileIndex].mimeType,
          });
        }),
      );
    } catch {
      await prisma.reviewImageSyncOperation.update({
        where: { id: reservation.operation.id },
        data: { status: "WAITING_RETRY", leaseOwner: null, leaseExpiresAt: null },
      });
      throw storageUnavailable();
    }
  }
  const snapshot = await finalizeReviewImageSync(
    deps,
    userId,
    reservation.operation,
    reservation.rows,
    manifest,
    reservation.leaseOwner!,
  );
  return signSnapshot(deps, snapshot, false);
};

export const getReviewImageSyncStatus = async (
  deps: ReviewImageSyncDeps,
  userId: number,
  reviewId: number,
  idempotencyKey: string,
): Promise<ReviewImageSyncStatusDto> => {
  const operation = await findSyncOperation(userId, reviewId, idempotencyKey);
  if (!operation)
    throw new AppError(
      "Review image sync operation not found",
      404,
      "REVIEW_IMAGE_SYNC_OPERATION_NOT_FOUND",
    );
  const status: ReviewImageSyncStatusDto = {
    reviewId,
    status: operation.status,
    expectedVersion: operation.expectedVersion,
    retryable: operation.status === "PROCESSING" || operation.status === "WAITING_RETRY",
    updatedAt: operation.updatedAt.toISOString(),
  };
  if (operation.status === "PROCESSING" && operation.leaseExpiresAt)
    status.retryAfterMs = Math.max(
      0,
      operation.leaseExpiresAt.getTime() - reviewImageNow(deps).getTime(),
    );
  if (operation.status === "SUCCEEDED")
    status.result = await signSnapshot(deps, snapshotFromJson(operation.result), true);
  if (operation.status === "FAILED") {
    const details = (operation.errorDetails ?? {}) as { message?: string; details?: unknown };
    status.error = {
      code: operation.errorCode ?? "REVIEW_IMAGE_SYNC_FAILED",
      message: details.message ?? "Review image sync failed",
      details: details.details,
    };
  }
  return status;
};
