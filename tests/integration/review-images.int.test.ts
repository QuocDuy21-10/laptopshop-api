import sharp from "sharp";
import { Readable } from "node:stream";
import { prisma } from "config/client";
import { createReview } from "modules/reviews/reviews.service";
import { addReviewImages, type ReviewImageDeps } from "modules/reviews/review-images.service";
import { createCompletedOrderItem, createProduct, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const inputFile = async (name: string): Promise<Express.Multer.File> => {
  const buffer = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "#166534" },
  })
    .png()
    .toBuffer();
  return {
    fieldname: "images",
    originalname: `${name}.png`,
    encoding: "7bit",
    mimetype: "image/png",
    destination: "",
    filename: `${name}.png`,
    path: "",
    size: buffer.length,
    buffer,
    stream: Readable.from(buffer),
  };
};

describe("review image concurrency", () => {
  it("never reserves more than three images when two owner requests race for the last slot", async () => {
    const user = await createUser();
    const product = await createProduct(3);
    const item = await createCompletedOrderItem(user.id, product.id);
    const review = await createReview(user.id, product.id, {
      rating: 5,
      content: "Nội dung đủ dài cho review có ảnh thật.",
      isAnonymous: true,
    });
    await prisma.reviewImage.createMany({
      data: [0, 1].map((position) => ({
        reviewId: review.id,
        objectKey: `reviews/${review.id}/existing-${position}.webp`,
        mimeType: "image/webp",
        byteSize: 10,
        width: 10,
        height: 10,
        position,
        status: "READY" as const,
      })),
    });

    const deps: ReviewImageDeps = {
      storage: {
        putObject: async () => new Promise<void>((resolve) => setTimeout(resolve, 20)),
        deleteObject: async () => undefined,
        objectExists: async () => true,
        getSignedReadUrl: async (key) => `https://storage.test/${key}`,
      },
    };
    const [first, second] = await Promise.allSettled([
      addReviewImages(deps, user.id, review.id, [await inputFile("first")]),
      addReviewImages(deps, user.id, review.id, [await inputFile("second")]),
    ]);

    expect([first, second].filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(
      [first, second]
        .filter((result) => result.status === "rejected")
        .map((result) => (result as PromiseRejectedResult).reason.code),
    ).toEqual(["REVIEW_IMAGE_LIMIT_REACHED"]);
    expect(
      await prisma.reviewImage.count({
        where: { reviewId: review.id, status: { in: ["PENDING", "READY"] } },
      }),
    ).toBe(3);
    expect(item.id).toBeGreaterThan(0);
  });
});
