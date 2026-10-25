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

const flashSalePromotion = (overrides: Record<string, unknown> = {}) => ({
  id: 42,
  name: "Flash",
  discountKind: "FIXED",
  discountValue: 5_000_000,
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
        totalQuota: 2,
        claimedUnits: 0,
        maxUnitsPerUser: 10,
        product: { price: 20_000_000 },
        usages: [{ userId: 7, claimedUnits: 0 }],
      },
    ],
  },
  ...overrides,
});

const automaticPromotion = (overrides: Record<string, unknown> = {}) => ({
  id: 41,
  name: "Automatic",
  discountKind: "FIXED",
  discountValue: 1_000_000,
  pricingVersion: 2,
  startsAt: new Date("2026-10-01T00:00:00Z"),
  endsAt: new Date("2026-11-01T00:00:00Z"),
  automaticPolicy: { priority: 1, stackableWithCoupon: true },
  products: [{ productId: 1, product: { price: 20_000_000 } }],
  flashSalePolicy: null,
  ...overrides,
});

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

  it("falls back a quota-short Flash Sale line to its Automatic winner", async () => {
    prismaMock.cartDetail.findMany.mockResolvedValue([
      { ...cartLines[0], quantity: 3, product: { id: 1, price: 20_000_000, isActive: true } },
    ]);
    prismaMock.promotion.findMany.mockResolvedValue([flashSalePromotion(), automaticPromotion()]);

    const result = await quoteOrder(7);

    expect(result).toMatchObject({ total: 57_000_000, productDiscount: 3_000_000 });
    expect(result.lines[0]).toMatchObject({
      promotionKind: "AUTOMATIC",
      promotionFallback: {
        skippedKind: "FLASH_SALE",
        promotionId: 42,
        reason: "GLOBAL_QUOTA",
        requestedQuantity: 3,
        availableQuantity: 2,
        appliedPromotionKind: "AUTOMATIC",
      },
    });
  });

  it("returns the list-price line when a quota-short Flash Sale has no fallback winner", async () => {
    prismaMock.cartDetail.findMany.mockResolvedValue([
      { ...cartLines[0], quantity: 3, product: { id: 1, price: 20_000_000, isActive: true } },
    ]);
    prismaMock.promotion.findMany.mockResolvedValue([flashSalePromotion()]);

    const result = await quoteOrder(7);

    expect(result).toMatchObject({ total: 60_000_000, productDiscount: 0 });
    expect(result.lines[0]).toMatchObject({
      promotionKind: null,
      promotionFallback: expect.objectContaining({
        reason: "GLOBAL_QUOTA",
        appliedPromotionKind: null,
      }),
    });
  });

  it("applies a stackable coupon after the resolved Automatic fallback", async () => {
    prismaMock.cartDetail.findMany.mockResolvedValue([
      { ...cartLines[0], quantity: 3, product: { id: 1, price: 20_000_000, isActive: true } },
    ]);
    prismaMock.promotion.findMany.mockResolvedValue([flashSalePromotion(), automaticPromotion()]);

    const result = await quoteOrder(7, "WELCOME10");

    expect(result).toMatchObject({
      couponEligibleSubtotal: 57_000_000,
      couponDiscount: 5_700_000,
      total: 51_300_000,
    });
  });
});
