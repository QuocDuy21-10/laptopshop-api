import { prisma } from "config/client";
import {
  createReview,
  getAdminReviewSummary,
  moderateReview,
} from "modules/reviews/reviews.service";
import { createCompletedOrderItem, createProduct, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const reviewData = (userId: number, productId: number, orderDetailId: number, rating = 5) => ({
  userId,
  productId,
  orderDetailId,
  rating,
  title: "Ổn định",
  content: "Máy chạy ổn định cho công việc hằng ngày.",
  isAnonymous: true,
  status: "PUBLISHED" as const,
});

describe("review database invariants", () => {
  it("persists review images through the review relation and preserves them during moderation", async () => {
    const user = await createUser();
    const admin = await createUser();
    const product = await createProduct(2);
    const item = await createCompletedOrderItem(user.id, product.id);
    const review = await prisma.review.create({ data: reviewData(user.id, product.id, item.id) });

    const image = await prisma.reviewImage.create({
      data: {
        reviewId: review.id,
        objectKey: `reviews/${review.id}/one.webp`,
        mimeType: "image/webp",
        byteSize: 120,
        width: 800,
        height: 600,
        position: 0,
        status: "READY",
      },
    });

    expect(image.status).toBe("READY");
    expect(
      (
        await prisma.review.findUniqueOrThrow({
          where: { id: review.id },
          include: { images: true },
        })
      ).images,
    ).toHaveLength(1);

    await moderateReview(admin.id, review.id, { status: "HIDDEN", reason: "Cần xem lại" });
    expect(
      await prisma.reviewImage.count({ where: { reviewId: review.id, status: "READY" } }),
    ).toBe(1);
  });

  it("allows only the declared image lifecycle states and unique object keys", async () => {
    const user = await createUser();
    const product = await createProduct(2);
    const item = await createCompletedOrderItem(user.id, product.id);
    const review = await prisma.review.create({ data: reviewData(user.id, product.id, item.id) });
    const objectKey = `reviews/${review.id}/pending.webp`;

    await prisma.reviewImage.create({
      data: {
        reviewId: review.id,
        objectKey,
        mimeType: "image/webp",
        byteSize: 10,
        width: 10,
        height: 10,
        position: 0,
        status: "PENDING",
      },
    });
    await expect(
      prisma.reviewImage.create({
        data: {
          reviewId: review.id,
          objectKey,
          mimeType: "image/webp",
          byteSize: 10,
          width: 10,
          height: 10,
          position: 1,
          status: "DELETING",
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects rating outside 1..5 at the database boundary", async () => {
    const user = await createUser();
    const product = await createProduct(2);
    const item = await createCompletedOrderItem(user.id, product.id);

    await expect(
      prisma.review.create({ data: reviewData(user.id, product.id, item.id, 0) }),
    ).rejects.toThrow();
  });

  it("lets exactly one of two concurrent createReview calls win", async () => {
    const user = await createUser();
    const product = await createProduct(2);
    const item = await createCompletedOrderItem(user.id, product.id);

    const results = await Promise.allSettled([
      createReview(user.id, product.id, {
        rating: 5,
        content: "Nội dung đủ dài cho đánh giá đầu tiên.",
        isAnonymous: true,
      }),
      createReview(user.id, product.id, {
        rating: 4,
        content: "Nội dung đủ dài cho đánh giá thứ hai.",
        isAnonymous: true,
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(
      results
        .filter((result) => result.status === "rejected")
        .map((result) => (result as PromiseRejectedResult).reason.code),
    ).toEqual(["REVIEW_ALREADY_EXISTS"]);
    expect(await prisma.review.count({ where: { userId: user.id, productId: product.id } })).toBe(
      1,
    );
    expect(item.id).toBeGreaterThan(0);
  });

  it("lets exactly one concurrent reactivation clear deletedAt", async () => {
    const user = await createUser();
    const product = await createProduct(2);
    const item = await createCompletedOrderItem(user.id, product.id);
    const deleted = await prisma.review.create({
      data: {
        ...reviewData(user.id, product.id, item.id),
        deletedAt: new Date(),
      },
    });

    const results = await Promise.allSettled([
      createReview(user.id, product.id, {
        rating: 5,
        content: "Nội dung viết lại lần một đủ dài.",
        isAnonymous: true,
      }),
      createReview(user.id, product.id, {
        rating: 4,
        content: "Nội dung viết lại lần hai đủ dài.",
        isAnonymous: true,
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(
      results
        .filter((result) => result.status === "rejected")
        .map((result) => (result as PromiseRejectedResult).reason.code),
    ).toEqual(["REVIEW_ALREADY_EXISTS"]);
    expect(
      (await prisma.review.findUniqueOrThrow({ where: { id: deleted.id } })).deletedAt,
    ).toBeNull();
  });

  it("never republishes a hidden review through delete and rewrite", async () => {
    const user = await createUser();
    const product = await createProduct(2);
    const item = await createCompletedOrderItem(user.id, product.id);
    const hidden = await prisma.review.create({
      data: {
        ...reviewData(user.id, product.id, item.id),
        status: "HIDDEN",
        deletedAt: new Date(),
      },
    });

    const rewritten = await createReview(user.id, product.id, {
      rating: 5,
      content: "Nội dung ẩn được viết lại đủ dài.",
      isAnonymous: true,
    });

    expect(rewritten.status).toBe("HIDDEN");
    expect((await prisma.review.findUniqueOrThrow({ where: { id: hidden.id } })).status).toBe(
      "HIDDEN",
    );
  });

  it("updates admin summary across create, moderation and soft delete", async () => {
    const user = await createUser();
    const admin = await createUser();
    const product = await createProduct(2);
    const item = await createCompletedOrderItem(user.id, product.id);
    const review = await prisma.review.create({ data: reviewData(user.id, product.id, item.id) });

    expect((await getAdminReviewSummary()).publishedReviews).toBe(1);
    await moderateReview(admin.id, review.id, { status: "HIDDEN", reason: "Cần xem lại" });
    expect((await getAdminReviewSummary()).hiddenReviews).toBe(1);
    await moderateReview(admin.id, review.id, { status: "PUBLISHED" });
    expect((await getAdminReviewSummary()).publishedReviews).toBe(1);
    await prisma.review.update({ where: { id: review.id }, data: { deletedAt: new Date() } });
    expect((await getAdminReviewSummary()).deletedReviews).toBe(1);
  });

  it("allows only one review per user and product", async () => {
    const user = await createUser();
    const product = await createProduct(3);
    const firstItem = await createCompletedOrderItem(user.id, product.id);
    const secondItem = await createCompletedOrderItem(user.id, product.id);

    await prisma.review.create({ data: reviewData(user.id, product.id, firstItem.id) });
    await expect(
      prisma.review.create({ data: reviewData(user.id, product.id, secondItem.id) }),
    ).rejects.toThrow();
  });

  it("allows only one review per order detail", async () => {
    const firstUser = await createUser();
    const secondUser = await createUser();
    const product = await createProduct(3);
    const item = await createCompletedOrderItem(firstUser.id, product.id);

    await prisma.review.create({ data: reviewData(firstUser.id, product.id, item.id) });
    await expect(
      prisma.review.create({ data: reviewData(secondUser.id, product.id, item.id) }),
    ).rejects.toThrow();
  });

  it("keeps author, product and purchase evidence referenced", async () => {
    const user = await createUser();
    const product = await createProduct(2);
    const item = await createCompletedOrderItem(user.id, product.id);
    const review = await prisma.review.create({
      data: reviewData(user.id, product.id, item.id),
      include: { user: true, product: true, orderDetail: { include: { order: true } } },
    });

    expect(review.user.id).toBe(user.id);
    expect(review.product.id).toBe(product.id);
    expect(review.orderDetail.id).toBe(item.id);
    expect(review.orderDetail.order.status).toBe("COMPLETED");
    expect(review.orderDetail.order.paymentStatus).toBe("PAYMENT_SUCCESS");
  });
});
