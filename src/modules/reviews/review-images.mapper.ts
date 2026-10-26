import { Prisma } from "@prisma/client";

export const reviewImageSelect = {
  id: true,
  objectKey: true,
  mimeType: true,
  byteSize: true,
  width: true,
  height: true,
  position: true,
  status: true,
  deletedAt: true,
  storageDeletedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ReviewImageSelect;

export type ReviewImageRow = Prisma.ReviewImageGetPayload<{ select: typeof reviewImageSelect }>;

export const toOwnerReviewImageDto = (
  image: ReviewImageRow,
  url: string,
  urlExpiresAt: string,
) => ({
  id: image.id,
  url,
  urlExpiresAt,
  mimeType: image.mimeType,
  width: image.width,
  height: image.height,
  position: image.position,
});

export type OwnerReviewImageDto = ReturnType<typeof toOwnerReviewImageDto>;
