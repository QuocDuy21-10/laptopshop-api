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
  it("keeps checkout quota errors available when the Flash Sale cannot cover the requested quantity", async () => {
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
              maxUnitsPerUser: 2,
              product: { price: 1_000 },
              usages: [{ userId: 7, claimedUnits: 0 }],
            },
          ],
        },
      }),
    ]);

    const result = await resolveProductPromotions({ promotion: { findMany } }, [1], now, 7);

    expect(result.get(1)).toMatchObject({ kind: "FLASH_SALE", remainingQuota: 1 });
  });

  it("selects the winner by priority, discount and id regardless of database row order", async () => {
    const findMany = jest.fn().mockResolvedValue([
      row({
        id: 20,
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
              usages: [],
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
        automaticPolicy: { priority: 2, stackableWithCoupon: false },
        flashSalePolicy: null,
        products: [{ productId: 1, product: { price: 1_000 } }],
      },
    ]);

    const result = await resolveProductPromotions({ promotion: { findMany } }, [1], now, 7);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: {
        kind: { in: ["AUTOMATIC", "FLASH_SALE"] },
        state: "ACTIVE",
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
    });
    expect(result.get(1)).toMatchObject({
      id: 10,
      kind: "AUTOMATIC",
    });
  });

  it("returns the running Flash Sale with quota and user snapshots when it wins", async () => {
    const findMany = jest.fn().mockResolvedValue([
      row({
        id: 20,
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

    const result = await resolveProductPromotions({ promotion: { findMany } }, [1], now, 7);

    expect(result.get(1)).toMatchObject({
      id: 20,
      kind: "FLASH_SALE",
      unitDiscount: 500,
      totalQuota: 10,
      claimedUnits: 3,
      remainingQuota: 7,
      maxUnitsPerUser: 2,
      userClaimedUnits: 1,
      userRemainingQuota: 1,
    });
  });
});
