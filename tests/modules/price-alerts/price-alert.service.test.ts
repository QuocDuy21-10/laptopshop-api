jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));
jest.mock("modules/promotions/promotion-resolver", () => ({
  resolveAutomaticPromotions: jest.fn(),
}));
jest.mock("modules/pricing/alert-price-resolver", () => ({
  resolveAlertPriceSnapshots: jest.fn(),
}));

import { describe, expect, beforeEach, it } from "@jest/globals";
import { resolveAutomaticPromotions } from "modules/promotions/promotion-resolver";
import { resolveAlertPriceSnapshots } from "modules/pricing/alert-price-resolver";
import { runPriceAlertSweep } from "modules/price-alerts/price-alert.service";
import { prismaMock, resetPrisma } from "../../helpers/prisma";

const product = (id: number, price: number, quantity = 3, isActive = true) => ({
  id,
  name: `Product ${id}`,
  price,
  quantity,
  isActive,
});

const item = (
  id: number,
  productId: number,
  referencePrice: number | null,
  mode: "PERCENT_DROP" | "TARGET_PRICE" = "PERCENT_DROP",
) => ({
  id,
  userId: 7,
  productId,
  alertMode: mode,
  targetPrice: mode === "TARGET_PRICE" ? 800 : null,
  referencePrice,
  includeFlashSale: false,
  alertVersion: 1,
});

beforeEach(() => {
  resetPrisma();
  (resolveAutomaticPromotions as jest.Mock).mockResolvedValue(new Map());
  (resolveAlertPriceSnapshots as jest.Mock).mockResolvedValue(new Map());
});

describe("runPriceAlertSweep", () => {
  it("deduplicates and sorts watched products before one resolver call per batch", async () => {
    prismaMock.wishlistItem.findMany
      .mockResolvedValueOnce([{ productId: 2 }, { productId: 1 }, { productId: 2 }])
      .mockResolvedValueOnce([item(11, 1, 1_000)])
      .mockResolvedValueOnce([item(12, 2, 2_000)]);
    prismaMock.product.findMany
      .mockResolvedValueOnce([product(1, 1_000)])
      .mockResolvedValueOnce([product(2, 2_000)]);

    const result = await runPriceAlertSweep({
      client: prismaMock,
      now: new Date(),
      productBatchSize: 1,
    });

    expect(result).toMatchObject({
      productsScanned: 2,
      itemsEvaluated: 2,
      notificationsCreated: 0,
    });
    expect((resolveAlertPriceSnapshots as jest.Mock).mock.calls).toHaveLength(2);
  });

  it("uses automatic promotion pricing and skips inactive or out-of-stock products", async () => {
    prismaMock.wishlistItem.findMany
      .mockResolvedValueOnce([{ productId: 1 }, { productId: 2 }, { productId: 3 }])
      .mockResolvedValueOnce([item(11, 1, 1_000), item(12, 2, 1_000), item(13, 3, 1_000)]);
    prismaMock.product.findMany.mockResolvedValue([
      product(1, 1_000),
      product(2, 1_000, 0),
      product(3, 1_000, 3, false),
    ]);
    prismaMock.wishlistItem.updateMany.mockResolvedValue({ count: 1 });
    (resolveAlertPriceSnapshots as jest.Mock).mockResolvedValue(
      new Map([
        [
          11,
          {
            productId: 1,
            listPrice: 1_000,
            stablePrice: 950,
            effectivePrice: 950,
            source: "AUTOMATIC",
            promotionId: 4,
            pricingVersion: 1,
            validUntil: new Date(),
            purchasable: true,
          },
        ],
      ]),
    );
    prismaMock.notification.create.mockResolvedValue({ id: 1 });
    prismaMock.wishlistItem.updateMany.mockResolvedValue({ count: 1 });

    const result = await runPriceAlertSweep({
      client: prismaMock,
      now: new Date(),
      productBatchSize: 10,
    });

    expect(result.itemsEvaluated).toBe(3);
    expect(result.notificationsCreated).toBe(1);
    expect(prismaMock.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ newPrice: 950 }) }),
    );
  });

  it("triggers a Flash Sale alert without lowering the stable reference price", async () => {
    prismaMock.wishlistItem.findMany
      .mockResolvedValueOnce([{ productId: 1 }])
      .mockResolvedValueOnce([item(11, 1, 1_000)]);
    prismaMock.product.findMany.mockResolvedValue([product(1, 1_000)]);
    (resolveAlertPriceSnapshots as jest.Mock).mockResolvedValue(
      new Map([
        [
          11,
          {
            productId: 1,
            listPrice: 1_000,
            stablePrice: 1_000,
            effectivePrice: 500,
            source: "FLASH_SALE",
            promotionId: 20,
            pricingVersion: 7,
            validUntil: new Date("2026-10-23T00:00:00.000Z"),
            purchasable: true,
          },
        ],
      ]),
    );
    prismaMock.notification.create.mockResolvedValue({ id: 1 });
    prismaMock.wishlistItem.updateMany.mockResolvedValue({ count: 1 });

    await runPriceAlertSweep({
      client: prismaMock,
      now: new Date(),
      productBatchSize: 10,
    });

    expect(prismaMock.wishlistItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ referencePrice: 1_000 }),
      }),
    );
  });

  it("counts malformed alert state without throwing", async () => {
    prismaMock.wishlistItem.findMany
      .mockResolvedValueOnce([{ productId: 1 }])
      .mockResolvedValueOnce([item(11, 1, null)]);
    prismaMock.product.findMany.mockResolvedValue([product(1, 1_000)]);

    const result = await runPriceAlertSweep({
      client: prismaMock,
      now: new Date(),
      productBatchSize: 10,
    });

    expect(result.invalidStatesSkipped).toBe(1);
    expect(result.errors).toBe(0);
  });

  it("keeps processing later batches after a batch read error", async () => {
    prismaMock.wishlistItem.findMany
      .mockResolvedValueOnce([{ productId: 1 }, { productId: 2 }])
      .mockRejectedValueOnce(new Error("batch failed"))
      .mockResolvedValueOnce([item(12, 2, 2_000)]);
    prismaMock.product.findMany
      .mockRejectedValueOnce(new Error("batch failed"))
      .mockResolvedValueOnce([product(2, 2_000)]);

    const result = await runPriceAlertSweep({
      client: prismaMock,
      now: new Date(),
      productBatchSize: 1,
    });

    expect(result.errors).toBe(1);
    expect(result.itemsEvaluated).toBe(1);
  });
});
