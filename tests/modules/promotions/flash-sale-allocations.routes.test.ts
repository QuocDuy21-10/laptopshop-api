jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";
import { ADMIN, cookieFor } from "../../helpers/auth";

beforeEach(resetPrisma);

describe("admin Flash Sale allocations", () => {
  it("lists allocation history with pagination and private user fields scoped to admin DTO", async () => {
    prismaMock.promotion.findUnique.mockResolvedValue({
      id: 42,
      kind: "FLASH_SALE",
      state: "ACTIVE",
      name: "Flash",
      discountKind: "PERCENT",
      discountValue: 20,
      pricingVersion: 1,
      startsAt: new Date("2026-10-01"),
      endsAt: new Date("2026-11-01"),
      activatedAt: new Date("2026-10-01"),
      createdAt: new Date("2026-09-01"),
      updatedAt: new Date("2026-09-01"),
      createdBy: null,
      updatedBy: null,
      couponPolicy: null,
      automaticPolicy: null,
      flashSalePolicy: null,
      products: [],
      _count: { redemptions: 0 },
    });
    prismaMock.flashSaleAllocation.count.mockResolvedValue(1);
    prismaMock.flashSaleAllocation.findMany.mockResolvedValue([
      {
        id: 1,
        promotionId: 42,
        productId: 3,
        userId: 7,
        orderId: 9,
        orderDetailId: 11,
        quantity: 1,
        discountAmount: 200,
        status: "CLAIMED",
        createdAt: new Date("2026-10-22"),
        releasedAt: null,
        releaseReason: null,
        user: { id: 7, username: "u@test.local", fullName: "U" },
        quota: { product: { id: 3, name: "Laptop" } },
        order: { id: 9, status: "PENDING" },
      },
    ]);

    const response = await request(buildApp())
      .get("/api/v1/admin/promotions/42/allocations?page=2&pageSize=10&status=CLAIMED")
      .set("Cookie", cookieFor(ADMIN));

    expect(response.status).toBe(200);
    expect(response.body.meta).toMatchObject({ page: 2, pageSize: 10, total: 1 });
    expect(response.body.items[0]).toMatchObject({
      promotionId: 42,
      productId: 3,
      quantity: 1,
      status: "CLAIMED",
    });
    expect(response.body.items[0]).not.toHaveProperty("password");
  });

  it("returns Flash Sale quota summary derived from current quotas and allocation history", async () => {
    prismaMock.promotion.findUnique.mockResolvedValue({
      id: 42,
      kind: "FLASH_SALE",
      flashSalePolicy: { quotas: [{ productId: 3, totalQuota: 10, claimedUnits: 2 }] },
    });
    prismaMock.flashSaleProductQuota.findMany.mockResolvedValue([
      { productId: 3, totalQuota: 10, claimedUnits: 2 },
    ]);
    prismaMock.flashSaleAllocation.aggregate
      .mockResolvedValueOnce({ _sum: { quantity: 3 }, _count: { _all: 3 } })
      .mockResolvedValueOnce({ _sum: { discountAmount: 400 }, _count: { _all: 2 } })
      .mockResolvedValueOnce({ _sum: { quantity: 1 }, _count: { _all: 1 } })
      .mockResolvedValueOnce({ _sum: { quantity: 2 }, _count: { _all: 2 } });

    const response = await request(buildApp())
      .get("/api/v1/admin/promotions/42/summary")
      .set("Cookie", cookieFor(ADMIN));

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      promotionId: 42,
      totalQuota: 10,
      claimedUnits: 2,
      allocationCount: 3,
      releasedUnits: 1,
      totalDiscountAmount: 400,
    });
    expect(prismaMock.flashSaleAllocation.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { promotionId: 42, status: "CLAIMED" },
        _sum: { discountAmount: true },
      }),
    );
  });
});
