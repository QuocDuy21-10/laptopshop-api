jest.mock("config/env", () => ({
  env: {
    ...jest.requireActual<typeof import("config/env")>("config/env").env,
    CATALOG_PROMOTION_PRICING_ENABLED: true,
  },
}));
jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));
jest.mock("modules/promotions/promotion-resolver", () => ({
  resolveProductPromotions: jest.fn().mockResolvedValue(new Map()),
}));

import { listProducts } from "modules/products/products.service";
import { listProductsQuery, type ListProductsQuery } from "modules/products/products.schema";
import { prismaMock, resetPrisma } from "../../helpers/prisma";

const product = {
  id: 1,
  name: "Asus",
  price: 17_490_000,
  image: "a.png",
  detailDesc: "d",
  shortDesc: "s",
  quantity: 5,
  sold: 0,
  factory: "ASUS",
  target: "GAMING",
  isActive: true,
};

beforeEach(() => resetPrisma());

describe("listProducts with projected catalog pricing", () => {
  it("keeps review summaries from the catalog page query", async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      {
        productId: 1,
        effectiveCatalogPrice: 15_000_000,
        averageRating: "4.5",
        totalReviews: BigInt(2),
        total: BigInt(1),
      },
    ]);
    prismaMock.product.findMany.mockResolvedValue([product]);

    const result = await listProducts(listProductsQuery.parse({}) as ListProductsQuery);

    expect(result.items[0]).toMatchObject({
      effectiveCatalogPrice: 15_000_000,
      reviewSummary: { averageRating: 4.5, totalReviews: 2 },
    });
    expect(result.meta.total).toBe(1);
  });
});
