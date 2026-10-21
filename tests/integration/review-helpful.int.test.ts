import { prisma } from "config/client";
import { markReviewHelpful, unmarkReviewHelpful } from "modules/reviews/review-helpful.service";
import { createCompletedOrderItem, createProduct, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("review helpful votes", () => {
  it("converges concurrent helpful votes to one membership and count one", async () => {
    const author = await createUser();
    const voter = await createUser();
    const product = await createProduct(2);
    const item = await createCompletedOrderItem(author.id, product.id);
    const review = await prisma.review.create({
      data: {
        userId: author.id,
        productId: product.id,
        orderDetailId: item.id,
        rating: 5,
        content: "Nội dung đủ dài để kiểm tra helpful vote đồng thời.",
        isAnonymous: true,
        status: "PUBLISHED",
      },
    });

    const results = await Promise.all([
      markReviewHelpful(voter.id, review.id),
      markReviewHelpful(voter.id, review.id),
    ]);

    expect(results).toEqual([
      { reviewId: review.id, helpfulCount: 1, helpful: true },
      { reviewId: review.id, helpfulCount: 1, helpful: true },
    ]);
    expect(await prisma.reviewHelpful.count({ where: { reviewId: review.id } })).toBe(1);
    await expect(markReviewHelpful(author.id, review.id)).rejects.toMatchObject({
      code: "REVIEW_HELPFUL_SELF_VOTE",
    });

    await expect(unmarkReviewHelpful(voter.id, review.id)).resolves.toEqual({
      reviewId: review.id,
      helpfulCount: 0,
      helpful: false,
    });
    await expect(unmarkReviewHelpful(voter.id, review.id)).resolves.toEqual({
      reviewId: review.id,
      helpfulCount: 0,
      helpful: false,
    });
  });

  it("does not allow votes on hidden or deleted reviews", async () => {
    const author = await createUser();
    const voter = await createUser();
    const product = await createProduct(2);
    const item = await createCompletedOrderItem(author.id, product.id);
    const review = await prisma.review.create({
      data: {
        userId: author.id,
        productId: product.id,
        orderDetailId: item.id,
        rating: 5,
        content: "Nội dung đủ dài để kiểm tra review không công khai.",
        isAnonymous: true,
        status: "HIDDEN",
        deletedAt: new Date(),
      },
    });

    await expect(markReviewHelpful(voter.id, review.id)).rejects.toMatchObject({
      code: "REVIEW_NOT_PUBLIC",
    });
    await expect(unmarkReviewHelpful(voter.id, review.id)).rejects.toMatchObject({
      code: "REVIEW_NOT_PUBLIC",
    });
  });
});
