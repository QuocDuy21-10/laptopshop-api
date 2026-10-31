jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";

const endpoint = "/api/v1/promotions/available";

beforeEach(() => {
  resetPrisma();
  prismaMock.promotion.findMany.mockResolvedValue([
    {
      id: 1,
      kind: "COUPON",
      state: "ACTIVE",
      name: "Public",
      discountKind: "PERCENT",
      discountValue: 10,
      startsAt: new Date("2026-10-01T00:00:00Z"),
      endsAt: new Date("2026-11-01T00:00:00Z"),
      couponPolicy: {
        code: "PUBLIC10",
        scope: "ORDER",
        minOrderValue: 0,
        maxDiscount: null,
        isPublic: true,
      },
      automaticPolicy: null,
      products: [],
    },
    {
      id: 2,
      kind: "COUPON",
      state: "ACTIVE",
      name: "Private",
      discountKind: "PERCENT",
      discountValue: 10,
      startsAt: new Date("2026-10-01T00:00:00Z"),
      endsAt: new Date("2026-11-01T00:00:00Z"),
      couponPolicy: {
        code: "PRIVATE10",
        scope: "ORDER",
        minOrderValue: 0,
        maxDiscount: null,
        isPublic: false,
      },
      automaticPolicy: null,
      products: [],
    },
  ]);
});

it("hides public coupons whose usage is exhausted", async () => {
  prismaMock.promotion.findMany.mockResolvedValue([
    {
      id: 3,
      kind: "COUPON",
      state: "ACTIVE",
      name: "Sold out",
      discountKind: "PERCENT",
      discountValue: 10,
      startsAt: new Date("2026-10-01T00:00:00Z"),
      endsAt: new Date("2026-11-01T00:00:00Z"),
      couponPolicy: {
        code: "SOLDOUT",
        scope: "ORDER",
        minOrderValue: 0,
        maxDiscount: null,
        maxUses: 5,
        usedCount: 5,
        isPublic: true,
      },
      automaticPolicy: null,
      products: [],
    },
  ]);
  const response = await request(buildApp()).get(endpoint);
  expect(response.status).toBe(200);
  expect(response.body.data).toEqual([]);
});

it("returns only explicitly public running promotions without auth", async () => {
  const response = await request(buildApp()).get(endpoint);
  expect(response.status).toBe(200);
  expect(response.body.data).toHaveLength(1);
  expect(response.body.data[0]).toMatchObject({ code: "PUBLIC10" });
  expect(response.body.data[0]).not.toHaveProperty("usedCount");
});
