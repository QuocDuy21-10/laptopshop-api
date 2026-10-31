import { randomUUID } from "node:crypto";
import { type Prisma, type ReviewImageSyncOperation } from "@prisma/client";

import { env } from "config/env";
import { AppError, isUniqueViolation } from "lib/errors";
import { prisma } from "config/client";
import { reviewImageNow, reviewImageTtl } from "modules/reviews/review-image-runtime";
import { type ReviewImageRow, reviewImageSelect } from "modules/reviews/review-images.mapper";
import type { ReviewImageDeps } from "modules/reviews/review-images.service";
import {
  failClaimedReviewImageSync,
  waitForClaimedReviewImageSyncRetry,
  isReviewImageSyncRetryExpired,
} from "modules/reviews/review-image-sync.state";
import type {
  ReviewImageSyncItem,
  ReviewImageSyncManifest,
} from "modules/reviews/review-image-sync.types";
import {
  processReviewImage,
  type ProcessedReviewImage,
} from "modules/reviews/review-images.processor";
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
  lockOwnedReviewStateForSync,
  lockOwnedSyncOperation,
} from "modules/reviews/review-image-sync.repository";
import { createReviewImageSyncFingerprint } from "modules/reviews/review-image-sync.fingerprint";

export type ReviewImageSyncDeps = ReviewImageDeps;

type ReservedImage = ReviewImageRow;
type Outcome<T> = { ok: true; value: T } | { ok: false; error: AppError };
const resultOf = <T>(outcome: Outcome<T>): T => {
  if (outcome.ok === false) throw outcome.error;
  return outcome.value;
};
type Reservation = {
  operation: ReviewImageSyncOperation;
  rows: ReservedImage[];
  replay: boolean;
  leaseOwner?: string;
};
const leaseLost = () =>
  new AppError("Review image sync lease was lost", 409, "REVIEW_IMAGE_SYNC_LEASE_LOST");
const claimFor = (operation: ReviewImageSyncOperation, leaseOwner: string) => ({
  operationId: operation.id,
  userId: operation.userId,
  reviewId: operation.reviewId,
  leaseOwner,
});

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
  const outcome = await prisma.$transaction<Outcome<Reservation>>(async (tx) => {
    const locked = await lockOwnedReviewStateForSync(tx, userId, reviewId);
    if (!locked) throw notFound();

    let operation = await tx.reviewImageSyncOperation.findUnique({
      where: { userId_reviewId_idempotencyKey: { userId, reviewId, idempotencyKey } },
    });
    if (operation) {
      if (operation.requestFingerprint !== fingerprint) throw idempotencyConflict();
      if (operation.status === "SUCCEEDED")
        return { ok: true, value: { operation, rows: [], replay: true } };
      if (operation.status === "FAILED") replayFailure(operation);
      if (
        operation.status === "PROCESSING" &&
        operation.leaseExpiresAt &&
        operation.leaseExpiresAt > now
      )
        throw inProgress();
      const expired = isReviewImageSyncRetryExpired(operation, now);
      operation = await tx.reviewImageSyncOperation.update({
        where: { id: operation.id },
        data: {
          status: "PROCESSING",
          leaseOwner,
          leaseExpiresAt: new Date(now.getTime() + env.REVIEW_IMAGE_SYNC_LEASE_MS),
          attemptCount: { increment: 1 },
        },
      });
      if (expired || locked.deletedAt) {
        const error = locked.deletedAt ? notFound() : storageUnavailable();
        await failClaimedReviewImageSync(
          tx,
          claimFor(operation, operation.leaseOwner ?? leaseOwner),
          error,
          now,
        );
        return { ok: false, error };
      }
      const rows = (await tx.reviewImage.findMany({
        where: {
          syncOperationId: operation.id,
          status: { in: ["PENDING", "READY"] },
          deletedAt: null,
        },
        select: reviewImageSelect,
      })) as ReservedImage[];
      return {
        ok: true,
        value: { operation, rows, replay: false, leaseOwner: operation.leaseOwner ?? leaseOwner },
      };
    } else {
      if (locked.deletedAt) throw notFound();
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
      await failClaimedReviewImageSync(
        tx,
        claimFor(operation, operation.leaseOwner ?? leaseOwner),
        error,
        now,
      );
      return { ok: false, error };
    }

    const active = await activeReviewImages(tx, reviewId);
    const existingIds = manifestExistingIds(manifest);
    if (existingIds.some((id) => !active.some((image) => image.id === id))) {
      const error = setConflict();
      await failClaimedReviewImageSync(
        tx,
        claimFor(operation, operation.leaseOwner ?? leaseOwner),
        error,
        now,
      );
      return { ok: false, error };
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
    return {
      ok: true,
      value: { operation, rows, replay: false, leaseOwner: operation.leaseOwner ?? leaseOwner },
    };
  });
  return resultOf(outcome);
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
  const outcome = await prisma.$transaction<Outcome<ReviewImageSyncSnapshot>>(async (tx) => {
    const locked = await lockOwnedReviewStateForSync(tx, userId, operation.reviewId);
    const currentOperation = await lockOwnedSyncOperation(
      tx,
      userId,
      operation.reviewId,
      operation.id,
    );
    if (
      !currentOperation ||
      currentOperation.status !== "PROCESSING" ||
      currentOperation.leaseOwner !== leaseOwner
    )
      throw leaseLost();
    const fail = async (error: AppError): Promise<Outcome<ReviewImageSyncSnapshot>> => {
      if (
        !(await failClaimedReviewImageSync(tx, claimFor(currentOperation, leaseOwner), error, now))
      )
        throw leaseLost();
      return { ok: false, error };
    };
    if (!locked || locked.deletedAt) return fail(notFound());
    if (locked.imageVersion !== manifest.expectedVersion)
      return fail(versionConflict(manifest.expectedVersion, locked.imageVersion));

    const active = await activeReviewImages(tx, operation.reviewId);
    const existingIds = manifestExistingIds(manifest);
    if (existingIds.some((id) => !active.some((image) => image.id === id)))
      return fail(setConflict());
    if (
      manifestNewItems(manifest).some(
        (item) =>
          !reservations.some(
            (row) =>
              row.syncOperationId === operation.id &&
              row.syncClientId === item.clientId &&
              row.status === "PENDING" &&
              !row.deletedAt,
          ),
      )
    )
      return fail(
        new AppError("Image reservations are incomplete", 409, "REVIEW_IMAGE_SYNC_FAILED"),
      );

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
    return { ok: true, value: snapshot };
  });
  return resultOf(outcome);
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
  let reservation: Awaited<ReturnType<typeof reserveOperation>>;
  try {
    reservation = await reserveOperation(
      deps,
      userId,
      reviewId,
      idempotencyKey,
      manifest,
      fingerprint,
      processed,
    );
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    reservation = await reserveOperation(
      deps,
      userId,
      reviewId,
      idempotencyKey,
      manifest,
      fingerprint,
      processed,
    );
  }
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
      await prisma.$transaction(async (tx) => {
        await lockOwnedReviewStateForSync(tx, userId, reviewId);
        const current = await lockOwnedSyncOperation(
          tx,
          userId,
          reviewId,
          reservation.operation.id,
        );
        if (!current) return;
        const claim = claimFor(current, reservation.leaseOwner!);
        if (isReviewImageSyncRetryExpired(current, reviewImageNow(deps)))
          await failClaimedReviewImageSync(tx, claim, storageUnavailable(), reviewImageNow(deps));
        else await waitForClaimedReviewImageSyncRetry(tx, claim, reviewImageNow(deps));
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
