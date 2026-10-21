jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));
jest.mock("modules/reviews/review-images.processor", () => ({
  processReviewImage: jest.fn(async (file: Express.Multer.File) => ({
    buffer: file.buffer,
    mimeType: "image/webp",
    byteSize: file.buffer.length,
    width: 100,
    height: 50,
  })),
}));

import { prismaMock, resetPrisma } from "../../helpers/prisma";
import {
  addReviewImages,
  deleteReviewImage,
  reorderReviewImages,
  type ReviewImageDeps,
} from "modules/reviews/review-images.service";

const file = (name: string): Express.Multer.File =>
  ({ originalname: name, buffer: Buffer.from(name), size: name.length }) as Express.Multer.File;

const review = { id: 18, status: "PUBLISHED" as const, deletedAt: null };
const image = (overrides: Record<string, unknown> = {}) => ({
  id: 21,
  reviewId: 18,
  objectKey: "reviews/18/21.webp",
  mimeType: "image/webp",
  byteSize: 10,
  width: 100,
  height: 50,
  position: 0,
  status: "READY" as const,
  deletedAt: null,
  storageDeletedAt: null,
  createdAt: new Date("2026-10-21T00:00:00.000Z"),
  updatedAt: new Date("2026-10-21T00:00:00.000Z"),
  ...overrides,
});

const storage = (): ReviewImageDeps => ({
  storage: {
    putObject: jest.fn().mockResolvedValue(undefined),
    deleteObject: jest.fn().mockResolvedValue(undefined),
    objectExists: jest.fn().mockResolvedValue(true),
    getSignedReadUrl: jest.fn().mockResolvedValue("https://signed.example/image.webp"),
  },
  now: () => new Date("2026-10-21T01:00:00.000Z"),
});

beforeEach(() => {
  resetPrisma();
  prismaMock.$queryRaw.mockResolvedValue([{ id: 18 }]);
});

describe("review image lifecycle service", () => {
  it("rejects a non-owner before reserving image rows", async () => {
    prismaMock.review.findFirst.mockResolvedValue(null);

    await expect(addReviewImages(storage(), 7, 18, [file("one")])).rejects.toMatchObject({
      code: "REVIEW_NOT_FOUND",
    });
    expect(prismaMock.reviewImage.create).not.toHaveBeenCalled();
  });

  it("allows an owner to add images to a hidden review", async () => {
    prismaMock.review.findFirst.mockResolvedValue({ ...review, status: "HIDDEN" });
    prismaMock.reviewImage.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([image({ status: "READY" })]);
    prismaMock.reviewImage.create.mockResolvedValue(image({ status: "PENDING" }));
    prismaMock.reviewImage.updateMany.mockResolvedValue({ count: 1 });

    await expect(addReviewImages(storage(), 7, 18, [file("one")])).resolves.toEqual([
      expect.objectContaining({ id: 21, status: "READY" }),
    ]);
  });

  it("enforces the three-image limit inside the reservation", async () => {
    prismaMock.review.findFirst.mockResolvedValue(review);
    prismaMock.reviewImage.findMany.mockResolvedValue([
      image(),
      image({ id: 22, position: 1 }),
      image({ id: 23, position: 2 }),
    ]);

    await expect(addReviewImages(storage(), 7, 18, [file("fourth")])).rejects.toMatchObject({
      code: "REVIEW_IMAGE_LIMIT_REACHED",
    });
    expect(prismaMock.reviewImage.create).not.toHaveBeenCalled();
  });

  it("does not expose a partial batch when one storage upload fails", async () => {
    const deps = storage();
    const putObject = deps.storage.putObject as jest.Mock;
    putObject.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("storage down"));
    prismaMock.review.findFirst.mockResolvedValue(review);
    prismaMock.reviewImage.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        image({ status: "READY" }),
        image({ id: 22, position: 1, status: "DELETING" }),
      ]);
    prismaMock.reviewImage.create
      .mockResolvedValueOnce(image({ status: "PENDING" }))
      .mockResolvedValueOnce(image({ id: 22, position: 1, status: "PENDING" }));
    prismaMock.reviewImage.updateMany.mockResolvedValue({ count: 2 });

    await expect(addReviewImages(deps, 7, 18, [file("one"), file("two")])).rejects.toMatchObject({
      code: "REVIEW_IMAGE_STORAGE_UNAVAILABLE",
      status: 503,
    });
    expect(prismaMock.reviewImage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "DELETING" }) }),
    );
  });

  it("rejects an incomplete or duplicate reorder set", async () => {
    prismaMock.review.findFirst.mockResolvedValue(review);
    prismaMock.reviewImage.findMany.mockResolvedValue([image(), image({ id: 22, position: 1 })]);

    await expect(reorderReviewImages(7, 18, [21, 21])).rejects.toMatchObject({
      code: "REVIEW_IMAGE_ORDER_INVALID",
    });
    expect(prismaMock.reviewImage.update).not.toHaveBeenCalled();
  });

  it("makes deleting an already deleted image idempotent", async () => {
    const deps = storage();
    prismaMock.review.findFirst.mockResolvedValue(review);
    prismaMock.reviewImage.findFirst.mockResolvedValue(
      image({ deletedAt: new Date(), status: "DELETING" }),
    );

    await expect(deleteReviewImage(deps, 7, 18, 21)).resolves.toBeUndefined();
    expect(deps.storage.deleteObject).not.toHaveBeenCalled();
  });
});
