export type ReviewImageSyncItem =
  | { kind: "existing"; clientId: string; imageId: number }
  | { kind: "new"; clientId: string; fileIndex: number };

export type ReviewImageSyncManifest = {
  expectedVersion: number;
  items: readonly ReviewImageSyncItem[];
};
import type { ReviewImageRow } from "modules/reviews/review-images.mapper";

export type ReviewImageSyncClaim = {
  operationId: number;
  userId: number;
  reviewId: number;
  leaseOwner: string;
};

export type ReviewImageSyncReservation = ReviewImageRow;
