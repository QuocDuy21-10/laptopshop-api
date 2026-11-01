jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";

const row = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  rating: 5,
  title: null,
  content: "Máy chạy êm, pin trâu, màn hình đẹp rất đáng tiền.",
  isAnonymous: false,
  createdAt: new Date("2026-10-20T08:00:00.000Z"),
  user: { fullName: "Lan" },
  product: { id: id * 10, name: `Laptop ${id}`, image: null },
  ...over,
});

const emptyAggregate = { _avg: { rating: null }, _count: { _all: 0 } };

beforeEach(resetPrisma);

describe("GET /api/v1/reviews/highlights", () => {
  it("returns the shop summary and items in the order chosen by SQL", async () => {
    prismaMock.review.aggregate.mockResolvedValue({
      _avg: { rating: 4.56 },
      _count: { _all: 128 },
    });
    prismaMock.$queryRaw.mockResolvedValue([
      { id: 2, helpfulCount: BigInt(9) },
      { id: 1, helpfulCount: BigInt(3) },
    ]);
    prismaMock.review.findMany.mockResolvedValue([row(1), row(2, { isAnonymous: true })]);

    const res = await request(buildApp()).get("/api/v1/reviews/highlights?limit=2");

    expect(res.status).toBe(200);
    expect(res.body.data.summary).toEqual({ averageRating: 4.6, totalReviews: 128 });
    expect(res.body.data.items.map((i: { id: number }) => i.id)).toEqual([2, 1]);
    expect(res.body.data.items[0]).toMatchObject({
      helpfulCount: 9,
      author: { name: "****", anonymous: true },
    });
    expect(res.body.data.items[0]).not.toHaveProperty("userId");
    const [statement] = prismaMock.$queryRaw.mock.calls[0];
    expect(statement.values).toContain(2);
    expect(prismaMock.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [2, 1] } } }),
    );
  });

  it("returns a null average and no items when there are no reviews", async () => {
    prismaMock.review.aggregate.mockResolvedValue(emptyAggregate);
    prismaMock.$queryRaw.mockResolvedValue([]);

    const res = await request(buildApp()).get("/api/v1/reviews/highlights");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ summary: { averageRating: null, totalReviews: 0 }, items: [] });
    expect(prismaMock.review.findMany).not.toHaveBeenCalled();
  });

  it("defaults the limit to 6 and rejects an out-of-range limit", async () => {
    prismaMock.review.aggregate.mockResolvedValue(emptyAggregate);
    prismaMock.$queryRaw.mockResolvedValue([]);
    await request(buildApp()).get("/api/v1/reviews/highlights");
    expect(prismaMock.$queryRaw.mock.calls[0][0].values).toContain(6);

    const bad = await request(buildApp()).get("/api/v1/reviews/highlights?limit=13");
    expect(bad.status).toBe(400);
  });

  it("only selects published, undeleted reviews of active products", async () => {
    prismaMock.review.aggregate.mockResolvedValue(emptyAggregate);
    prismaMock.$queryRaw.mockResolvedValue([]);
    await request(buildApp()).get("/api/v1/reviews/highlights");
    expect(prismaMock.review.aggregate).toHaveBeenCalledWith({
      where: { status: "PUBLISHED", deletedAt: null, product: { isActive: true } },
      _avg: { rating: true },
      _count: { _all: true },
    });
    const sql = prismaMock.$queryRaw.mock.calls[0][0].strings.join(" ");
    expect(sql).toContain("r.rating >=");
    expect(sql).toContain("CHAR_LENGTH(TRIM(r.content)) >=");
    expect(sql).toContain("PARTITION BY productId");
  });
});
