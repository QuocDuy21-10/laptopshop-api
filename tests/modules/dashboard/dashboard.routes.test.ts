jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";
import { ADMIN, cookieFor } from "../../helpers/auth";

beforeEach(resetPrisma);

describe("GET /api/v1/admin/dashboard", () => {
  it("returns counts, revenue and orders by status", async () => {
    prismaMock.user.count.mockResolvedValue(3);
    prismaMock.product.count.mockResolvedValue(10);
    prismaMock.order.count.mockResolvedValue(4);
    prismaMock.order.aggregate.mockResolvedValue({ _sum: { totalPrice: 900 } });
    prismaMock.order.groupBy.mockResolvedValue([
      { status: "PENDING", _count: { _all: 3 } },
      { status: "COMPLETED", _count: { _all: 1 } },
    ]);
    const res = await request(buildApp())
      .get("/api/v1/admin/dashboard")
      .set("Cookie", cookieFor(ADMIN));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      userCount: 3,
      productCount: 10,
      orderCount: 4,
      revenue: 900,
      ordersByStatus: { PENDING: 3, SHIPPING: 0, COMPLETED: 1, CANCELLED: 0 },
    });
    expect(prismaMock.order.aggregate.mock.calls[0][0]).toMatchObject({
      where: { status: "COMPLETED" },
    });
  });
});
