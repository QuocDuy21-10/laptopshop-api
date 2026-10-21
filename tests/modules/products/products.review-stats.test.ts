jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import { Product } from "@prisma/client";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import {
  emptyProductReviewSummary,
  getReviewStatsForProductIds,
} from "modules/products/products.review-stats.repository";
import { toCatalogProductDto } from "modules/products/products.mapper";

const product = { id: 7, name: "A", image: "a.webp" } as Product;

beforeEach(resetPrisma);

describe("product review stats", () => {
  it("fills empty product IDs without querying reviews", async () => {
    await expect(getReviewStatsForProductIds([])).resolves.toEqual(new Map());
    expect(prismaMock.review.groupBy).not.toHaveBeenCalled();
  });

  it("aggregates public review rows once and rounds averages to one decimal", async () => {
    prismaMock.review.groupBy.mockResolvedValue([
      { productId: 7, _avg: { rating: 4.56 }, _count: { _all: 25 } },
    ]);

    const result = await getReviewStatsForProductIds([7, 8]);

    expect(prismaMock.review.groupBy).toHaveBeenCalledTimes(1);
    expect(prismaMock.review.groupBy).toHaveBeenCalledWith({
      by: ["productId"],
      where: { productId: { in: [7, 8] }, status: "PUBLISHED", deletedAt: null },
      _avg: { rating: true },
      _count: { _all: true },
    });
    expect(result).toEqual(
      new Map([
        [7, { averageRating: 4.6, totalReviews: 25 }],
        [8, emptyProductReviewSummary],
      ]),
    );
  });

  it("maps a catalog product with an explicit zero-state summary", () => {
    expect(toCatalogProductDto(product)).toMatchObject({
      id: 7,
      image: "/images/product/a.webp",
      reviewSummary: emptyProductReviewSummary,
    });
  });
});
