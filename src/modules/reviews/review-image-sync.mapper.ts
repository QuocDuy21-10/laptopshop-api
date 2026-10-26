import type { ReviewImageSyncStatus } from "@prisma/client";

export type ReviewImageSyncSnapshotImage = {
  clientId: string;
  id: number;
  objectKey: string;
  mimeType: string;
  width: number;
  height: number;
  position: number;
};

export type ReviewImageSyncSnapshot = {
  reviewId: number;
  imageVersion: number;
  images: ReviewImageSyncSnapshotImage[];
};

export type ReviewImageSyncResultDto = Omit<ReviewImageSyncSnapshot, "images"> & {
  replayed: boolean;
  images: Array<
    Omit<ReviewImageSyncSnapshotImage, "objectKey"> & { url: string; urlExpiresAt: string }
  >;
};

export type ReviewImageSyncStatusDto = {
  reviewId: number;
  status: ReviewImageSyncStatus;
  expectedVersion: number;
  retryable: boolean;
  retryAfterMs?: number;
  result?: ReviewImageSyncResultDto;
  error?: { code: string; message: string; details?: unknown };
  updatedAt: string;
};

export const snapshotFromJson = (value: unknown): ReviewImageSyncSnapshot => {
  if (!value || typeof value !== "object") throw new Error("Invalid review image sync result");
  return value as ReviewImageSyncSnapshot;
};
