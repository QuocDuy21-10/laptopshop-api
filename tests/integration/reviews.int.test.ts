import { prisma } from "config/client";
import { createReview } from "modules/reviews/reviews.service";
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
