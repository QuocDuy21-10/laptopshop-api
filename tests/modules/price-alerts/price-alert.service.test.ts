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
import { evaluatePricingEvent, runPriceAlertSweep } from "modules/price-alerts/price-alert.service";
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
  it("pages product IDs and Wishlist items without loading the full watch set", async () => {
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ productId: 1 }, { productId: 2 }])
      .mockResolvedValueOnce([]);
    prismaMock.product.findMany.mockResolvedValue([product(1, 1_000), product(2, 2_000)]);
    prismaMock.wishlistItem.findMany
      .mockResolvedValueOnce([item(11, 1, 1_000)])
      .mockResolvedValueOnce([item(12, 2, 2_000)])
      .mockResolvedValueOnce([]);
    const onProductBatchComplete = jest.fn().mockResolvedValue(true);

    const result = await runPriceAlertSweep({
      client: prismaMock,
      now: new Date(),
      productBatchSize: 2,
      itemBatchSize: 1,
      onProductBatchComplete,
    });

    expect(result).toMatchObject({ completed: true, lastProductId: 2, stopReason: "COMPLETED" });
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prismaMock.wishlistItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 1,
        orderBy: { id: "asc" },
      }),
    );
    expect(onProductBatchComplete).toHaveBeenCalledWith(2, expect.anything());
  });

  it("stops on discovery failure without claiming a successful page", async () => {
    prismaMock.$queryRaw.mockRejectedValueOnce(new Error("discovery failed"));
    const onProductBatchComplete = jest.fn().mockResolvedValue(true);

    const result = await runPriceAlertSweep({
      client: prismaMock,
      now: new Date(),
      productBatchSize: 2,
      itemBatchSize: 1,
      onProductBatchComplete,
    });

    expect(result).toMatchObject({ completed: false, stopReason: "BATCH_ERROR" });
    expect(result.stats.errors).toBe(1);
    expect(onProductBatchComplete).not.toHaveBeenCalled();
  });

  it("stops after a checkpoint callback rejects ownership", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ productId: 1 }]).mockResolvedValueOnce([]);
    prismaMock.product.findMany.mockResolvedValue([product(1, 1_000)]);
    prismaMock.wishlistItem.findMany.mockResolvedValueOnce([]);
    const onProductBatchComplete = jest.fn().mockResolvedValue(false);

    const result = await runPriceAlertSweep({
      client: prismaMock,
      now: new Date(),
      productBatchSize: 1,
      itemBatchSize: 1,
      onProductBatchComplete,
    });

    expect(result).toMatchObject({
      completed: false,
      lastProductId: 1,
      stopReason: "CHECKPOINT_REJECTED",
    });
  });

  it("deduplicates and sorts watched products before one resolver call per batch", async () => {
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ productId: 1 }])
      .mockResolvedValueOnce([{ productId: 2 }])
      .mockResolvedValueOnce([]);
    prismaMock.wishlistItem.findMany
      .mockResolvedValueOnce([item(11, 1, 1_000)])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([item(12, 2, 2_000)])
      .mockResolvedValueOnce([]);
    prismaMock.product.findMany
      .mockResolvedValueOnce([product(1, 1_000)])
      .mockResolvedValueOnce([product(2, 2_000)]);

    const result = await runPriceAlertSweep({
      client: prismaMock,
      now: new Date(),
      productBatchSize: 1,
    });

    expect(result).toMatchObject({
      stats: { productsScanned: 2, itemsEvaluated: 2, notificationsCreated: 0 },
    });
    expect((resolveAlertPriceSnapshots as jest.Mock).mock.calls).toHaveLength(2);
  });

  it("uses automatic promotion pricing and skips inactive or out-of-stock products", async () => {
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ productId: 1 }, { productId: 2 }, { productId: 3 }])
      .mockResolvedValueOnce([]);
    prismaMock.wishlistItem.findMany.mockResolvedValueOnce([
      item(11, 1, 1_000),
      item(12, 2, 1_000),
      item(13, 3, 1_000),
    ]);
    prismaMock.wishlistItem.findMany.mockResolvedValueOnce([]);
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
    prismaMock.notification.upsert.mockResolvedValue({ id: 1 });
    prismaMock.wishlistItem.updateMany.mockResolvedValue({ count: 1 });

    const result = await runPriceAlertSweep({
      client: prismaMock,
      now: new Date(),
      productBatchSize: 10,
    });

    expect(result.stats.itemsEvaluated).toBe(3);
    expect(result.stats.notificationsCreated).toBe(1);
    expect(prismaMock.notification.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ newPrice: 950 }) }),
    );
  });

  it("triggers a Flash Sale alert without lowering the stable reference price", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ productId: 1 }]).mockResolvedValueOnce([]);
    prismaMock.wishlistItem.findMany.mockResolvedValueOnce([item(11, 1, 1_000)]);
    prismaMock.wishlistItem.findMany.mockResolvedValueOnce([]);
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
    prismaMock.notification.upsert.mockResolvedValue({ id: 1 });
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
    prismaMock.$queryRaw.mockResolvedValueOnce([{ productId: 1 }]).mockResolvedValueOnce([]);
    prismaMock.wishlistItem.findMany.mockResolvedValueOnce([item(11, 1, null)]);
    prismaMock.wishlistItem.findMany.mockResolvedValueOnce([]);
    prismaMock.product.findMany.mockResolvedValue([product(1, 1_000)]);

    const result = await runPriceAlertSweep({
      client: prismaMock,
      now: new Date(),
      productBatchSize: 10,
    });

    expect(result.stats.invalidStatesSkipped).toBe(1);
    expect(result.stats.errors).toBe(0);
  });

  it("stops and preserves the cursor after a batch read error", async () => {
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ productId: 1 }, { productId: 2 }])
      .mockResolvedValueOnce([]);
    prismaMock.product.findMany
      .mockRejectedValueOnce(new Error("batch failed"))
      .mockResolvedValueOnce([product(2, 2_000)]);
    prismaMock.wishlistItem.findMany
      .mockResolvedValueOnce([item(12, 2, 2_000)])
      .mockResolvedValueOnce([]);

    const result = await runPriceAlertSweep({
      client: prismaMock,
      now: new Date(),
      productBatchSize: 1,
    });

    expect(result.stats.errors).toBe(1);
    expect(result.stats.itemsEvaluated).toBe(0);
    expect(result.stopReason).toBe("BATCH_ERROR");
  });
});

describe("evaluatePricingEvent", () => {
  it("evaluates only canonical event product IDs and never discovers all watched products", async () => {
    prismaMock.product.findMany.mockResolvedValue([product(1, 1_000), product(3, 1_000)]);
    prismaMock.wishlistItem.findMany.mockResolvedValue([]);

    await evaluatePricingEvent(
      prismaMock,
      { productIds: [3, 1, 3, 0, -1, Number.NaN] },
      new Date(),
      2,
      2,
    );

    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
    expect(prismaMock.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [1, 3] } } }),
    );
  });

  it("treats an empty event scope as a no-op", async () => {
    const result = await evaluatePricingEvent(
      prismaMock,
      { productIds: [0, -1, Number.NaN] },
      new Date(),
      2,
      2,
    );

    expect(result).toMatchObject({ productsScanned: 0, itemsEvaluated: 0, errors: 0 });
    expect(prismaMock.product.findMany).not.toHaveBeenCalled();
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });
});
