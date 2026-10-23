import { resolveAlertPriceSnapshots } from "modules/pricing/alert-price-resolver";

const now = new Date("2026-10-22T00:00:00.000Z");

const product = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  price: 1_000,
  quantity: 5,
  isActive: true,
  ...overrides,
});

const automatic = {
  id: 10,
  name: "Automatic 10%",
  discountKind: "PERCENT" as const,
  discountValue: 10,
  pricingVersion: 2,
  startsAt: new Date("2026-10-01T00:00:00.000Z"),
  endsAt: new Date("2026-11-01T00:00:00.000Z"),
  automaticPolicy: { priority: 1, stackableWithCoupon: true },
  products: [{ productId: 1, product: { price: 1_000 } }],
  flashSalePolicy: null,
};

const flash = {
  id: 20,
  name: "Flash 50%",
  discountKind: "PERCENT" as const,
  discountValue: 50,
  pricingVersion: 7,
  startsAt: new Date("2026-10-21T00:00:00.000Z"),
  endsAt: new Date("2026-10-23T00:00:00.000Z"),
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
        usages: [
          { userId: 7, claimedUnits: 1 },
          { userId: 8, claimedUnits: 2 },
        ],
      },
    ],
  },
};

const client = () => ({
  product: { findMany: jest.fn().mockResolvedValue([product()]) },
  promotion: { findMany: jest.fn().mockResolvedValue([automatic, flash]) },
});

describe("resolveAlertPriceSnapshots", () => {
  it("uses stable pricing when the Wishlist item does not include Flash Sale", async () => {
    const db = client();
    const result = await resolveAlertPriceSnapshots(
      db,
      [{ wishlistItemId: 1, userId: 7, productId: 1, includeFlashSale: false }],
      now,
    );

    expect(result.get(1)).toMatchObject({
      productId: 1,
      listPrice: 1_000,
      stablePrice: 900,
      effectivePrice: 900,
      source: "AUTOMATIC",
      promotionId: 10,
      purchasable: true,
    });
  });

  it("uses each user's remaining Flash Sale quota in one batched resolution", async () => {
    const db = client();
    const result = await resolveAlertPriceSnapshots(
      db,
      [
        { wishlistItemId: 7, userId: 7, productId: 1, includeFlashSale: true },
        { wishlistItemId: 8, userId: 8, productId: 1, includeFlashSale: true },
      ],
      now,
    );

    expect(result.get(7)).toMatchObject({
      effectivePrice: 500,
      source: "FLASH_SALE",
      promotionId: 20,
      pricingVersion: 7,
      validUntil: flash.endsAt,
    });
    expect(result.get(8)).toMatchObject({
      effectivePrice: 900,
      source: "AUTOMATIC",
      promotionId: 10,
    });
    expect(db.product.findMany).toHaveBeenCalledTimes(1);
    expect(db.promotion.findMany).toHaveBeenCalledTimes(1);
  });

  it("marks an inactive or out-of-stock product as not purchasable", async () => {
    const db = {
      product: { findMany: jest.fn().mockResolvedValue([product({ quantity: 0 })]) },
      promotion: { findMany: jest.fn().mockResolvedValue([automatic]) },
    };

    const result = await resolveAlertPriceSnapshots(
      db,
      [{ wishlistItemId: 1, userId: 7, productId: 1, includeFlashSale: false }],
      now,
    );

    expect(result.get(1)).toMatchObject({ effectivePrice: 900, purchasable: false });
  });
});
