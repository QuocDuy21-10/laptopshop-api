import { resolveProductPromotions } from "modules/promotions/promotion-resolver";

const now = new Date("2026-10-22T00:00:00.000Z");

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 20,
  name: "Flash Sale",
  discountKind: "FIXED" as const,
  discountValue: 500,
  pricingVersion: 4,
  startsAt: new Date("2026-10-21T00:00:00.000Z"),
  endsAt: new Date("2026-10-23T00:00:00.000Z"),
  automaticPolicy: null,
  flashSalePolicy: {
    priority: 2,
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
  products: [],
  ...overrides,
});

describe("Flash Sale promotion resolver", () => {
  it("falls back to Automatic when a higher-priority Flash Sale cannot cover the line quantity", async () => {
    const findMany = jest.fn().mockResolvedValue([
      row({
        flashSalePolicy: {
          priority: 10,
          stackableWithCoupon: true,
          showRemainingQuota: true,
          quotas: [
            {
              productId: 1,
              totalQuota: 2,
              claimedUnits: 1,
              maxUnitsPerUser: 10,
              product: { price: 1_000 },
              usages: [{ userId: 7, claimedUnits: 0 }],
            },
          ],
        },
      }),
      {
        ...row(),
        id: 10,
        name: "Automatic fallback",
        discountKind: "PERCENT",
        discountValue: 10,
        automaticPolicy: { priority: 1, stackableWithCoupon: false },
        flashSalePolicy: null,
        products: [{ productId: 1, product: { price: 1_000 } }],
      },
    ]);

    const result = await resolveProductPromotions(
      { promotion: { findMany } },
      [{ productId: 1, quantity: 2 }],
      { now, userId: 7, eligibilityMode: "EXACT" },
    );

    expect(result.get(1)).toMatchObject({
      winner: { id: 10, kind: "AUTOMATIC" },
      fallback: {
        promotionId: 20,
        reason: "GLOBAL_QUOTA",
        requestedQuantity: 2,
        appliedPromotionKind: "AUTOMATIC",
      },
    });
  });

  it("records USER_QUOTA when the global quota is sufficient but the user has no quota left", async () => {
    const findMany = jest.fn().mockResolvedValue([
      row({
        flashSalePolicy: {
          priority: 3,
          stackableWithCoupon: true,
          showRemainingQuota: true,
          quotas: [
            {
              productId: 1,
              totalQuota: 10,
              claimedUnits: 3,
              maxUnitsPerUser: 2,
              product: { price: 1_000 },
              usages: [{ userId: 7, claimedUnits: 2 }],
            },
          ],
        },
      }),
      {
        ...row(),
        id: 10,
        name: "Automatic",
        discountKind: "PERCENT",
        discountValue: 50,
        automaticPolicy: { priority: 1, stackableWithCoupon: false },
        flashSalePolicy: null,
        products: [{ productId: 1, product: { price: 1_000 } }],
      },
    ]);

    const result = await resolveProductPromotions(
      { promotion: { findMany } },
      [{ productId: 1, quantity: 1 }],
      { now, userId: 7, eligibilityMode: "EXACT" },
    );

    expect(result.get(1)).toMatchObject({
      winner: { id: 10, kind: "AUTOMATIC" },
      fallback: { reason: "USER_QUOTA", userRemaining: 0, globalRemaining: 7 },
    });
  });

  it("allows a first-time authenticated user to win a Flash Sale when no usage row exists", async () => {
    const findMany = jest.fn().mockResolvedValue([
      row({
        flashSalePolicy: {
          priority: 3,
          stackableWithCoupon: true,
          showRemainingQuota: true,
          quotas: [
            {
              productId: 1,
              totalQuota: 10,
              claimedUnits: 3,
              maxUnitsPerUser: 2,
              product: { price: 1_000 },
              usages: [],
            },
          ],
        },
      }),
    ]);

    const result = await resolveProductPromotions(
      { promotion: { findMany } },
      [{ productId: 1, quantity: 1 }],
      { now, userId: 7, eligibilityMode: "EXACT" },
    );

    expect(result.get(1)).toMatchObject({
      winner: {
        id: 20,
        kind: "FLASH_SALE",
        userClaimedUnits: 0,
        userRemainingQuota: 2,
      },
      fallback: null,
    });
  });

  it("selects a globally available Flash Sale as POTENTIAL without loading user usage", async () => {
    const findMany = jest.fn().mockResolvedValue([
      row({
        flashSalePolicy: {
          priority: 3,
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
      }),
    ]);

    const result = await resolveProductPromotions(
      { promotion: { findMany } },
      [{ productId: 1, quantity: 1 }],
      { now, eligibilityMode: "POTENTIAL" },
    );

    expect(result.get(1)).toMatchObject({
      winner: {
        id: 20,
        kind: "FLASH_SALE",
        remainingQuota: 7,
      },
      eligibility: "POTENTIAL",
      fallback: null,
    });
    expect(
      findMany.mock.calls[0][0].include.flashSalePolicy.include.quotas.include,
    ).not.toHaveProperty("usages");
  });

  it("uses an inclusive start and exclusive end time window in the batch query", async () => {
    const findMany = jest.fn().mockResolvedValue([]);

    await resolveProductPromotions({ promotion: { findMany } }, [{ productId: 1, quantity: 1 }], {
      now,
      eligibilityMode: "POTENTIAL",
    });

    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: { startsAt: { lte: now }, endsAt: { gt: now } },
    });
  });

  it("normalizes duplicate product lines before checking Flash Sale availability", async () => {
    const findMany = jest.fn().mockResolvedValue([
      row({
        flashSalePolicy: {
          priority: 3,
          stackableWithCoupon: true,
          showRemainingQuota: true,
          quotas: [
            {
              productId: 1,
              totalQuota: 3,
              claimedUnits: 1,
              maxUnitsPerUser: 10,
              product: { price: 1_000 },
              usages: [],
            },
          ],
        },
      }),
      {
        ...row(),
        id: 10,
        name: "Automatic fallback",
        automaticPolicy: { priority: 1, stackableWithCoupon: false },
        flashSalePolicy: null,
        products: [{ productId: 1, product: { price: 1_000 } }],
      },
    ]);

    const result = await resolveProductPromotions(
      { promotion: { findMany } },
      [
        { productId: 1, quantity: 1 },
        { productId: 1, quantity: 2 },
      ],
      { now, eligibilityMode: "POTENTIAL" },
    );

    expect(result.get(1)).toMatchObject({
      winner: { id: 10, kind: "AUTOMATIC" },
      fallback: { reason: "GLOBAL_QUOTA", requestedQuantity: 3 },
    });
  });
});
