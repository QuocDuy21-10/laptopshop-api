import { prisma } from "config/client";
import { getReviewStatsForProductIds } from "modules/products/products.review-stats.repository";
import { createCompletedOrderItem, createProduct, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("product review stats on MySQL", () => {
  it("counts only published and non-deleted reviews and fills products without reviews", async () => {
    const publishedUser = await createUser();
    const hiddenUser = await createUser();
    const deletedUser = await createUser();
    const reviewed = await createProduct(1);
    const empty = await createProduct(1);

    const publishedItem = await createCompletedOrderItem(publishedUser.id, reviewed.id);
    const hiddenItem = await createCompletedOrderItem(hiddenUser.id, reviewed.id);
    const deletedItem = await createCompletedOrderItem(deletedUser.id, reviewed.id);
    await prisma.review.create({
      data: {
        userId: publishedUser.id,
        productId: reviewed.id,
        orderDetailId: publishedItem.id,
        rating: 4,
        content: "Đáng mua",
        isAnonymous: true,
        status: "PUBLISHED",
      },
    });
    await prisma.review.create({
      data: {
        userId: hiddenUser.id,
        productId: reviewed.id,
        orderDetailId: hiddenItem.id,
        rating: 5,
        content: "Ẩn",
        isAnonymous: true,
        status: "HIDDEN",
      },
    });
    await prisma.review.create({
      data: {
        userId: deletedUser.id,
        productId: reviewed.id,
        orderDetailId: deletedItem.id,
        rating: 1,
        content: "Đã xoá",
        isAnonymous: true,
        status: "PUBLISHED",
        deletedAt: new Date(),
      },
    });

    await expect(getReviewStatsForProductIds([reviewed.id, empty.id])).resolves.toEqual(
      new Map([
        [reviewed.id, { averageRating: 4, totalReviews: 1 }],
        [empty.id, { averageRating: null, totalReviews: 0 }],
      ]),
    );
  });
});
