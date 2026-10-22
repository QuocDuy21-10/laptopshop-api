jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";
import { ADMIN, USER, cookieFor } from "../../helpers/auth";

const endpoint = "/api/v1/admin/promotions";
const promotion = {
  id: 10,
  kind: "COUPON",
  state: "DRAFT",
  name: "Welcome",
  description: null,
  discountKind: "PERCENT",
  discountValue: 10,
  pricingVersion: 1,
  startsAt: new Date("2026-10-01T00:00:00.000Z"),
  endsAt: new Date("2026-11-01T00:00:00.000Z"),
  activatedAt: null,
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
  createdBy: { id: ADMIN.id, fullName: "Admin", username: "admin@gmail.com" },
  updatedBy: { id: ADMIN.id, fullName: "Admin", username: "admin@gmail.com" },
  couponPolicy: {
    promotionId: 10,
    code: "WELCOME10",
    scope: "ORDER",
    minOrderValue: 0,
    maxDiscount: null,
    maxUses: 100,
    usedCount: 0,
    maxUsesPerUser: 1,
    isPublic: false,
  },
  automaticPolicy: null,
  products: [],
  _count: { redemptions: 0 },
};

beforeEach(() => {
  resetPrisma();
  prismaMock.promotion.create.mockResolvedValue(promotion);
  prismaMock.promotion.findUnique.mockResolvedValue(promotion);
  prismaMock.promotion.findMany.mockResolvedValue([promotion]);
  prismaMock.promotion.count.mockResolvedValue(1);
  prismaMock.promotion.update.mockResolvedValue({
    ...promotion,
    state: "ACTIVE",
    activatedAt: new Date(),
  });
});

describe("admin promotion routes", () => {
  it("rejects non-admin callers", async () => {
    const response = await request(buildApp())
      .post(endpoint)
      .set("Cookie", cookieFor(USER))
      .send({
        kind: "COUPON",
        name: "Welcome",
        discountKind: "PERCENT",
        discountValue: 10,
        startsAt: "2026-10-01T00:00:00.000Z",
        endsAt: "2026-11-01T00:00:00.000Z",
        coupon: { code: "WELCOME10", scope: "ORDER", maxUsesPerUser: 1 },
      });
    expect(response.status).toBe(403);
  });

  it("creates a draft and maps the policy without returning a Prisma row", async () => {
    const response = await request(buildApp())
      .post(endpoint)
      .set("Cookie", cookieFor(ADMIN))
      .send({
        kind: "COUPON",
        name: "Welcome",
        discountKind: "PERCENT",
        discountValue: 10,
        startsAt: "2026-10-01T00:00:00.000Z",
        endsAt: "2026-11-01T00:00:00.000Z",
        coupon: { code: " welcome10 ", scope: "ORDER", maxUsesPerUser: 1 },
      });
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      id: 10,
      state: "DRAFT",
      coupon: { code: "WELCOME10" },
    });
    expect(response.body.data).not.toHaveProperty("password");
  });

  it("creates and returns a Flash Sale quota policy", async () => {
    const flashPromotion = {
      ...promotion,
      kind: "FLASH_SALE",
      couponPolicy: null,
      automaticPolicy: null,
      flashSalePolicy: {
        promotionId: 10,
        priority: 20,
        stackableWithCoupon: false,
        showRemainingQuota: true,
        quotas: [
          {
            promotionId: 10,
            productId: 3,
            totalQuota: 10,
            claimedUnits: 0,
            maxUnitsPerUser: 2,
            product: { id: 3, name: "Laptop", image: null },
          },
        ],
      },
    };
    prismaMock.promotion.create.mockResolvedValue(flashPromotion);
    const response = await request(buildApp())
      .post(endpoint)
      .set("Cookie", cookieFor(ADMIN))
      .send({
        kind: "FLASH_SALE",
        name: "Flash Sale",
        discountKind: "PERCENT",
        discountValue: 15,
        startsAt: "2026-10-01T00:00:00.000Z",
        endsAt: "2026-11-01T00:00:00.000Z",
        flashSale: {
          priority: 20,
          stackableWithCoupon: false,
          showRemainingQuota: true,
          items: [{ productId: 3, totalQuota: 10, maxUnitsPerUser: 2 }],
        },
      });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      kind: "FLASH_SALE",
      flashSale: { priority: 20, quotas: [{ productId: 3, totalQuota: 10 }] },
    });
  });

  it("lists promotions with pagination", async () => {
    const response = await request(buildApp())
      .get(`${endpoint}?page=2&pageSize=10`)
      .set("Cookie", cookieFor(ADMIN));
    expect(response.status).toBe(200);
    expect(response.body.meta).toMatchObject({ page: 2, pageSize: 10, total: 1 });
  });

  it("activates a draft and exposes a locked-field conflict", async () => {
    const response = await request(buildApp())
      .patch(`${endpoint}/10/state`)
      .set("Cookie", cookieFor(ADMIN))
      .send({ action: "ACTIVATE" });
    expect(response.status).toBe(200);
    expect(response.body.data.state).toBe("ACTIVE");

    prismaMock.promotion.findUnique.mockResolvedValue({
      ...promotion,
      state: "ACTIVE",
      activatedAt: new Date(),
    });
    const locked = await request(buildApp())
      .patch(`${endpoint}/10`)
      .set("Cookie", cookieFor(ADMIN))
      .send({ discountValue: 20 });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe("PROMOTION_FIELD_LOCKED");
  });

  it("allows only an active Flash Sale quota increase without bumping pricingVersion", async () => {
    const activeFlash = {
      ...promotion,
      kind: "FLASH_SALE",
      state: "ACTIVE",
      activatedAt: new Date("2026-10-01T00:00:00.000Z"),
      couponPolicy: null,
      automaticPolicy: null,
      flashSalePolicy: {
        promotionId: 10,
        priority: 20,
        stackableWithCoupon: false,
        showRemainingQuota: true,
        quotas: [
          {
            promotionId: 10,
            productId: 3,
            totalQuota: 5,
            claimedUnits: 1,
            maxUnitsPerUser: 2,
            product: { id: 3, name: "Laptop", image: null },
          },
        ],
      },
    };
    prismaMock.promotion.findUnique.mockResolvedValue(activeFlash);
    prismaMock.flashSalePolicy.update.mockResolvedValue(activeFlash.flashSalePolicy);
    prismaMock.flashSaleProductQuota.update.mockResolvedValue(
      activeFlash.flashSalePolicy.quotas[0],
    );
    prismaMock.promotion.update.mockResolvedValue(activeFlash);

    const response = await request(buildApp())
      .patch(`${endpoint}/10`)
      .set("Cookie", cookieFor(ADMIN))
      .send({
        flashSale: {
          items: [{ productId: 3, totalQuota: 10, maxUnitsPerUser: 2 }],
        },
      });

    expect(response.status).toBe(200);
    expect(prismaMock.flashSaleProductQuota.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { totalQuota: 10 },
      }),
    );
    expect(prismaMock.promotion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ pricingVersion: expect.anything() }),
      }),
    );
  });
});
