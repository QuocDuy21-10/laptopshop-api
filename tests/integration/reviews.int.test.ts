import { prisma } from "config/client";
import {
  createReview,
  deleteMyReview,
  getAdminReviewSummary,
  moderateReview,
  updateMyReview,
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

  it("enforces one helpful membership per user, supports multiple users, and preserves votes across hide/restore", async () => {
    const firstUser = await createUser();
    const secondUser = await createUser();
    const admin = await createUser();
    const product = await createProduct(2);
    const item = await createCompletedOrderItem(firstUser.id, product.id);
    const review = await prisma.review.create({
      data: reviewData(firstUser.id, product.id, item.id),
    });

    await prisma.reviewHelpful.create({ data: { reviewId: review.id, userId: secondUser.id } });
    await expect(
      prisma.reviewHelpful.create({ data: { reviewId: review.id, userId: secondUser.id } }),
    ).rejects.toThrow();

    const thirdUser = await createUser();
    await prisma.reviewHelpful.create({ data: { reviewId: review.id, userId: thirdUser.id } });
    expect(await prisma.reviewHelpful.count({ where: { reviewId: review.id } })).toBe(2);

    await moderateReview(admin.id, review.id, { status: "HIDDEN", reason: "Cần xem lại" });
    expect(await prisma.reviewHelpful.count({ where: { reviewId: review.id } })).toBe(2);
    await moderateReview(admin.id, review.id, { status: "PUBLISHED" });
    expect(await prisma.reviewHelpful.count({ where: { reviewId: review.id } })).toBe(2);
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

  it("soft-deletes review images and does not restore them on rewrite", async () => {
    const user = await createUser();
    const product = await createProduct(2);
    const item = await createCompletedOrderItem(user.id, product.id);
    const review = await createReview(user.id, product.id, {
      rating: 5,
      content: "Nội dung đủ dài cho review có ảnh trước khi xoá.",
      isAnonymous: true,
    });
    await prisma.reviewImage.create({
      data: {
        reviewId: review.id,
        objectKey: `reviews/${review.id}/old.webp`,
        mimeType: "image/webp",
        byteSize: 10,
        width: 10,
        height: 10,
        position: 0,
        status: "READY",
      },
    });

    await deleteMyReview(user.id, review.id);
    expect(
      await prisma.reviewImage.count({ where: { reviewId: review.id, status: "DELETING" } }),
    ).toBe(1);

    const rewritten = await createReview(user.id, product.id, {
      rating: 4,
      content: "Nội dung viết lại không kế thừa ảnh cũ.",
      isAnonymous: true,
    });
    expect(rewritten.images).toEqual([]);
    expect(item.id).toBeGreaterThan(0);
  });

  it("deletes helpful memberships before customer rewrite", async () => {
    const user = await createUser();
    const voter = await createUser();
    const product = await createProduct(2);
    const item = await createCompletedOrderItem(user.id, product.id);
    const review = await prisma.review.create({ data: reviewData(user.id, product.id, item.id) });
    await prisma.reviewHelpful.create({ data: { reviewId: review.id, userId: voter.id } });

    await deleteMyReview(user.id, review.id);
    expect(await prisma.reviewHelpful.count({ where: { reviewId: review.id } })).toBe(0);

    const rewritten = await createReview(user.id, product.id, {
      rating: 4,
      content: "Nội dung viết lại không kế thừa helpful cũ.",
      isAnonymous: true,
    });
    expect(rewritten).not.toHaveProperty("helpfulVotes");
    expect(await prisma.reviewHelpful.count({ where: { reviewId: rewritten.id } })).toBe(0);
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

  it("never writes moderation metadata after a concurrent customer delete", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const user = await createUser();
      const admin = await createUser();
      const product = await createProduct(2);
      const item = await createCompletedOrderItem(user.id, product.id);
      const review = await prisma.review.create({
        data: {
          ...reviewData(user.id, product.id, item.id),
          status: "HIDDEN",
          hiddenReason: "Cần xem lại",
        },
      });

      await Promise.allSettled([
        moderateReview(admin.id, review.id, { status: "PUBLISHED" }),
        deleteMyReview(user.id, review.id),
      ]);

      const final = await prisma.review.findUniqueOrThrow({ where: { id: review.id } });
      expect(final.deletedAt).not.toBeNull();
      if (final.status === "PUBLISHED" && final.moderatedAt) {
        expect(final.moderatedById).toBe(admin.id);
        expect(final.hiddenReason).toBeNull();
        expect(final.moderatedAt.getTime()).toBeLessThanOrEqual(final.deletedAt!.getTime());
      } else {
        expect(final.status).toBe("HIDDEN");
        expect(final.hiddenReason).toBe("Cần xem lại");
        expect(final.moderatedAt).toBeNull();
        expect(final.moderatedById).toBeNull();
      }
    }
  });

  it("never updates review content after a concurrent customer delete", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const user = await createUser();
      const product = await createProduct(2);
      const item = await createCompletedOrderItem(user.id, product.id);
      const review = await prisma.review.create({ data: reviewData(user.id, product.id, item.id) });

      await Promise.allSettled([
        updateMyReview(user.id, review.id, { content: "Nội dung mới đủ dài sau chỉnh sửa." }),
        deleteMyReview(user.id, review.id),
      ]);

      const final = await prisma.review.findUniqueOrThrow({ where: { id: review.id } });
      expect(final.deletedAt).not.toBeNull();
      expect([
        "Máy chạy ổn định cho công việc hằng ngày.",
        "Nội dung mới đủ dài sau chỉnh sửa.",
      ]).toContain(final.content);
      if (final.content === "Nội dung mới đủ dài sau chỉnh sửa.") {
        expect(final.rating).toBe(5);
      }
      expect(final.contentUpdatedAt.getTime()).toBeLessThanOrEqual(final.deletedAt!.getTime());
    }
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
