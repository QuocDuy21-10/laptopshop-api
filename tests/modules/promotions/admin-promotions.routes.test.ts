jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import { prismaError, prismaMock, resetPrisma } from "../../helpers/prisma";
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
  prismaMock.product.findMany.mockImplementation(async (args: any) =>
    (args?.where?.id?.in ?? []).map((id: number) => ({ id })),
  );
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

  it("rejects promotions that target unknown products without writing", async () => {
    prismaMock.product.findMany.mockResolvedValue([{ id: 3 }]);
    const draft = {
      name: "Unknown targets",
      discountKind: "PERCENT",
      discountValue: 10,
      startsAt: "2026-10-01T00:00:00.000Z",
      endsAt: "2026-11-01T00:00:00.000Z",
    };
    for (const body of [
      { ...draft, kind: "AUTOMATIC", automatic: { targetProductIds: [3, 99999999] } },
      {
        ...draft,
        kind: "COUPON",
        coupon: { code: "QA10", scope: "PRODUCT", targetProductIds: [99999999] },
      },
      {
        ...draft,
        kind: "FLASH_SALE",
        flashSale: { items: [{ productId: 99999999, totalQuota: 5, maxUnitsPerUser: 1 }] },
      },
    ]) {
      const response = await request(buildApp())
        .post(endpoint)
        .set("Cookie", cookieFor(ADMIN))
        .send(body);
      expect(response.status).toBe(400);
      expect(response.body.error).toMatchObject({
        code: "PRODUCT_NOT_FOUND",
        details: { productIds: [99999999] },
      });
    }
    expect(prismaMock.promotion.create).not.toHaveBeenCalled();
  });

  it("rejects unknown products when replacing draft Flash Sale items", async () => {
    prismaMock.promotion.findUnique.mockResolvedValue({
      ...promotion,
      kind: "FLASH_SALE",
      couponPolicy: null,
      flashSalePolicy: { promotionId: 10, priority: 0, stackableWithCoupon: false, quotas: [] },
    });
    prismaMock.product.findMany.mockResolvedValue([]);
    const response = await request(buildApp())
      .patch(`${endpoint}/10`)
      .set("Cookie", cookieFor(ADMIN))
      .send({ flashSale: { items: [{ productId: 99999999, totalQuota: 5, maxUnitsPerUser: 1 }] } });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("PRODUCT_NOT_FOUND");
    expect(prismaMock.flashSaleProductQuota.deleteMany).not.toHaveBeenCalled();
  });

  it("maps a duplicate coupon code to 409", async () => {
    prismaMock.promotion.create.mockRejectedValue(prismaError("P2002"));
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
        coupon: { code: "WELCOME10", scope: "ORDER", maxUsesPerUser: 1 },
      });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("COUPON_CODE_TAKEN");
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

  it("keeps pricing reevaluation events distinct for promotions that share a product", async () => {
    const target = {
      ...promotion,
      products: [{ productId: 3, product: { id: 3, name: "Laptop", image: null } }],
    };
    const dedupeKeys: string[] = [];
    prismaMock.outboxEvent.create.mockImplementation(
      async ({ data }: { data: { dedupeKey: string } }) => {
        dedupeKeys.push(data.dedupeKey);
        return data;
      },
    );
    for (const id of [10, 11]) {
      prismaMock.promotion.findUnique.mockResolvedValue({ ...target, id });
      prismaMock.promotion.update.mockResolvedValue({
        ...target,
        id,
        state: "ACTIVE",
        pricingVersion: 2,
      });
      const response = await request(buildApp())
        .patch(`${endpoint}/${id}/state`)
        .set("Cookie", cookieFor(ADMIN))
        .send({ action: "ACTIVATE" });
      expect(response.status).toBe(200);
    }
    expect(dedupeKeys).toHaveLength(2);
    expect(new Set(dedupeKeys).size).toBe(2);
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
