jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";

const reviewRow = {
  id: 18,
  productId: 12,
  rating: 5,
  title: "Ổn định",
  content: "Máy chạy ổn định cho công việc hằng ngày.",
  isAnonymous: true,
  createdAt: new Date("2026-10-21T03:00:00.000Z"),
  contentUpdatedAt: new Date("2026-10-21T04:00:00.000Z"),
  user: { fullName: "Nguyễn Văn A" },
};

beforeEach(resetPrisma);

describe("GET /api/v1/products/:id/reviews", () => {
  it("lists only public reviews with a stable newest sort", async () => {
    prismaMock.product.findUnique.mockResolvedValue({ id: 12, isActive: true });
    prismaMock.review.count.mockResolvedValue(1);
    prismaMock.review.findMany.mockResolvedValue([reviewRow]);

    const res = await request(buildApp()).get("/api/v1/products/12/reviews?page=2&pageSize=5");

    expect(res.status).toBe(200);
    expect(res.body.data[0].author.name).toBe("****");
    expect(res.body.meta).toEqual({ page: 2, pageSize: 5, total: 1, totalPages: 1 });
    expect(prismaMock.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productId: 12, status: "PUBLISHED", deletedAt: null },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: 5,
        take: 5,
      }),
    );
  });

  it("supports rating filtering and rejects unknown sorting", async () => {
    prismaMock.product.findUnique.mockResolvedValue({ id: 12, isActive: true });
    prismaMock.review.count.mockResolvedValue(0);
    prismaMock.review.findMany.mockResolvedValue([]);

    expect(
      (await request(buildApp()).get("/api/v1/products/12/reviews?rating=5&sort=highest")).status,
    ).toBe(200);
    expect(prismaMock.review.findMany.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        where: { productId: 12, status: "PUBLISHED", deletedAt: null, rating: 5 },
        orderBy: [{ rating: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      }),
    );
    expect((await request(buildApp()).get("/api/v1/products/12/reviews?sort=random")).status).toBe(
      400,
    );
  });

  it("returns 404 for an inactive product", async () => {
    prismaMock.product.findUnique.mockResolvedValue({ id: 12, isActive: false });

    const res = await request(buildApp()).get("/api/v1/products/12/reviews");

    expect(res.status).toBe(404);
    expect(prismaMock.review.findMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/products/:id/reviews/summary", () => {
  it("calculates public distribution and average", async () => {
    prismaMock.product.findUnique.mockResolvedValue({ id: 12, isActive: true });
    prismaMock.review.groupBy.mockResolvedValue([
      { rating: 5, _count: { _all: 2 } },
      { rating: 4, _count: { _all: 1 } },
    ]);

    const res = await request(buildApp()).get("/api/v1/products/12/reviews/summary");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      productId: 12,
      averageRating: 4.7,
      totalReviews: 3,
      distribution: { "1": 0, "2": 0, "3": 0, "4": 1, "5": 2 },
    });
    expect(prismaMock.review.groupBy).toHaveBeenCalledWith({
      by: ["rating"],
      where: { productId: 12, status: "PUBLISHED", deletedAt: null },
      _count: { _all: true },
    });
  });

  it("returns null average for a product with no public reviews", async () => {
    prismaMock.product.findUnique.mockResolvedValue({ id: 12, isActive: true });
    prismaMock.review.groupBy.mockResolvedValue([]);

    const res = await request(buildApp()).get("/api/v1/products/12/reviews/summary");

    expect(res.status).toBe(200);
    expect(res.body.data.averageRating).toBeNull();
    expect(res.body.data.totalReviews).toBe(0);
  });
});
