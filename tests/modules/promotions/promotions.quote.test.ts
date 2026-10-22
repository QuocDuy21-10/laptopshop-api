jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { quoteOrder } from "modules/promotions/promotions.service";

const cartLines = [
  { id: 1, productId: 1, quantity: 1, product: { id: 1, price: 1_000, isActive: true } },
  { id: 2, productId: 2, quantity: 1, product: { id: 2, price: 2_000, isActive: true } },
];

const couponPromotion = {
  id: 10,
  kind: "COUPON",
  state: "ACTIVE",
  name: "Welcome",
  discountKind: "PERCENT",
  discountValue: 10,
  pricingVersion: 1,
  startsAt: new Date("2026-10-01T00:00:00Z"),
  endsAt: new Date("2026-11-01T00:00:00Z"),
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
  activatedAt: new Date("2026-10-01T00:00:00Z"),
  description: null,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  updatedAt: new Date("2026-09-01T00:00:00Z"),
  createdBy: null,
  updatedBy: null,
};

beforeEach(() => {
  resetPrisma();
  prismaMock.cartDetail.findMany.mockResolvedValue(cartLines);
  prismaMock.promotion.findMany.mockResolvedValue([]);
  prismaMock.promotion.findFirst.mockResolvedValue(couponPromotion);
});

describe("quoteOrder", () => {
  it("quotes the authenticated cart without claiming usage", async () => {
    const result = await quoteOrder(7);
    expect(result).toMatchObject({ subtotal: 3_000, productDiscount: 0, total: 3_000 });
    expect(prismaMock.couponPolicy.update).not.toHaveBeenCalled();
    expect(prismaMock.promotionUserUsage.upsert).not.toHaveBeenCalled();
  });

  it("applies a private order coupon when the caller knows its code", async () => {
    const result = await quoteOrder(7, " welcome10 ");
    expect(result).toMatchObject({ couponDiscount: 300, total: 2_700 });
    expect(result.coupon).toMatchObject({ code: "WELCOME10", valid: true });
  });

  it("does not apply a product coupon outside its target lines", async () => {
    prismaMock.promotion.findFirst.mockResolvedValue({
      ...couponPromotion,
      couponPolicy: { ...couponPromotion.couponPolicy, scope: "PRODUCT" },
      products: [{ productId: 1 }],
    });
    const result = await quoteOrder(7, "WELCOME10");
    expect(result.couponEligibleSubtotal).toBe(1_000);
    expect(result.couponDiscount).toBe(100);
    expect(result.total).toBe(2_900);
  });

  it("returns the winning Flash Sale quota snapshot and authenticated user remaining quota", async () => {
    prismaMock.promotion.findMany.mockResolvedValue([
      {
        id: 42,
        name: "Flash",
        discountKind: "PERCENT",
        discountValue: 20,
        pricingVersion: 3,
        startsAt: new Date("2026-10-01T00:00:00Z"),
        endsAt: new Date("2026-11-01T00:00:00Z"),
        automaticPolicy: null,
        products: [],
        flashSalePolicy: {
          priority: 10,
          stackableWithCoupon: true,
          showRemainingQuota: true,
          quotas: [
            {
              productId: 1,
              totalQuota: 10,
              claimedUnits: 3,
              maxUnitsPerUser: 2,
              product: { price: 1_000 },
              usages: [{ userId: 7, claimedUnits: 1 }],
            },
          ],
        },
      },
    ]);

    const result = await quoteOrder(7);

    expect(result.lines[0]).toMatchObject({
      promotionKind: "FLASH_SALE",
      flashSale: { remainingQuota: 7, maxUnitsPerUser: 2, userRemainingQuota: 1 },
    });
    expect(result.total).toBe(2_800);
  });

  it("rejects a Flash Sale quote when the snapshot cannot cover the cart without fallback", async () => {
    prismaMock.cartDetail.findMany.mockResolvedValue([cartLines[0]]);
    prismaMock.promotion.findMany.mockResolvedValue([
      {
        id: 42,
        name: "Flash",
        discountKind: "PERCENT",
        discountValue: 20,
        pricingVersion: 3,
        startsAt: new Date("2026-10-01T00:00:00Z"),
        endsAt: new Date("2026-11-01T00:00:00Z"),
        automaticPolicy: null,
        products: [],
        flashSalePolicy: {
          priority: 10,
          stackableWithCoupon: true,
          showRemainingQuota: true,
          quotas: [
            {
              productId: 1,
              totalQuota: 1,
              claimedUnits: 1,
              maxUnitsPerUser: 1,
              product: { price: 1_000 },
              usages: [],
            },
          ],
        },
      },
    ]);

    await expect(quoteOrder(7)).rejects.toMatchObject({
      code: "FLASH_SALE_QUOTA_EXCEEDED",
      details: { promotionId: 42, productId: 1, requestedQuantity: 1 },
    });
  });
});
