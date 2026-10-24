import { Product } from "@prisma/client";
import { prisma } from "config/client";
import { env } from "config/env";
import { isUniqueViolation } from "lib/errors";
import {
  resolveAlertPriceSnapshots,
  type PriceSnapshot,
} from "modules/pricing/alert-price-resolver";
import { evaluatePriceAlert } from "modules/price-alerts/price-alert.policy";
import { publishNotification } from "modules/notifications/notification-publish.service";

export type PriceAlertSweepStats = {
  productsScanned: number;
  itemsEvaluated: number;
  notificationsCreated: number;
  duplicatesSkipped: number;
  invalidStatesSkipped: number;
  errors: number;
};

export type PriceAlertSweepStopReason =
  "COMPLETED" | "LEASE_LOST" | "BATCH_ERROR" | "CHECKPOINT_REJECTED";

export type PriceAlertSweepResult = {
  stats: PriceAlertSweepStats;
  lastProductId: number;
  completed: boolean;
  stopReason: PriceAlertSweepStopReason;
};

export type RunPriceAlertSweepInput = {
  client: typeof prisma;
  now: Date;
  productBatchSize: number;
  itemBatchSize?: number;
  startAfterProductId?: number;
  logger?: {
    warn: (fields: unknown, message: string) => void;
    error: (fields: unknown, message: string) => void;
  };
  shouldContinue?: () => boolean;
  onProductBatchComplete?: (lastProductId: number, stats: PriceAlertSweepStats) => Promise<boolean>;
};

export type PriceAlertCandidate = {
  wishlistItemId: number;
  userId: number;
  productId: number;
  productName: string;
  mode: "PERCENT_DROP" | "TARGET_PRICE";
  referencePrice: number;
  targetPrice: number | null;
  stablePrice: number;
  currentPrice: number;
  source: PriceSnapshot["source"];
  promotionId: number | null;
  pricingVersion: number | null;
  validUntil: Date | null;
  alertVersion: number;
  includeFlashSale: boolean;
};

class StaleAlertConfiguration extends Error {}

const chunk = <T>(items: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const notificationContent = (candidate: PriceAlertCandidate) =>
  candidate.mode === "TARGET_PRICE"
    ? {
        title: "Sản phẩm yêu thích đã đạt giá mục tiêu",
        message:
          candidate.productName +
          " đã đạt mức giá mục tiêu " +
          String(candidate.targetPrice) +
          "đ.",
      }
    : {
        title: "Sản phẩm yêu thích vừa giảm giá",
        message:
          candidate.productName +
          " đã giảm từ " +
          String(candidate.referencePrice) +
          "đ xuống " +
          String(candidate.currentPrice) +
          "đ.",
      };

export const commitPriceAlertCandidate = async (
  client: typeof prisma,
  candidate: PriceAlertCandidate,
  now: Date,
): Promise<"created" | "duplicate" | "stale"> => {
  try {
    await client.$transaction(async (tx) => {
      const content = notificationContent(candidate);
      const dedupeKey = [
        "price-alert",
        candidate.wishlistItemId,
        candidate.alertVersion,
        candidate.mode,
        candidate.referencePrice,
        candidate.currentPrice,
        candidate.source,
        candidate.promotionId ?? "none",
        candidate.pricingVersion ?? "none",
      ].join("-");

      const data =
        candidate.mode === "TARGET_PRICE"
          ? {
              alertMode: null,
              targetPrice: null,
              referencePrice: null,
              lastAlertMode: "TARGET_PRICE" as const,
              lastAlertedPrice: candidate.currentPrice,
              lastAlertedAt: now,
            }
          : {
              referencePrice:
                candidate.source === "FLASH_SALE"
                  ? candidate.referencePrice
                  : candidate.stablePrice,
              lastAlertMode: "PERCENT_DROP" as const,
              lastAlertedPrice: candidate.currentPrice,
              lastAlertedAt: now,
            };
      const updated = await tx.wishlistItem.updateMany({
        where: {
          id: candidate.wishlistItemId,
          alertMode: candidate.mode,
          alertVersion: candidate.alertVersion,
          includeFlashSale: candidate.includeFlashSale,
          referencePrice: candidate.referencePrice,
          targetPrice: candidate.targetPrice,
        },
        data,
      });
      if (updated.count !== 1) throw new StaleAlertConfiguration();
      await publishNotification(tx, {
        category: "PRICE_ALERT",
        userId: candidate.userId,
        productId: candidate.productId,
        type: "PRICE_DROP",
        title: content.title,
        message: content.message,
        oldPrice: candidate.referencePrice,
        newPrice: candidate.currentPrice,
        priceSource: candidate.source,
        promotionId: candidate.promotionId,
        pricingVersion: candidate.pricingVersion,
        validUntil: candidate.validUntil,
        dedupeKey,
      });
    });
    return "created";
  } catch (error) {
    if (error instanceof StaleAlertConfiguration) return "stale";
    if (isUniqueViolation(error)) return "duplicate";
    throw error;
  }
};

type WatchedItem = {
  id: number;
  userId: number;
  productId: number;
  alertMode: "PERCENT_DROP" | "TARGET_PRICE" | null;
  targetPrice: number | null;
  referencePrice: number | null;
  includeFlashSale: boolean;
  alertVersion: number;
};

type ScanProduct = Pick<Product, "id" | "name" | "price" | "quantity" | "isActive">;
type ProductPageResult = "COMPLETED" | "LEASE_LOST" | "BATCH_ERROR";

const emptyStats = (): PriceAlertSweepStats => ({
  productsScanned: 0,
  itemsEvaluated: 0,
  notificationsCreated: 0,
  duplicatesSkipped: 0,
  invalidStatesSkipped: 0,
  errors: 0,
});

const evaluateProductPage = async (input: {
  client: typeof prisma;
  productIds: number[];
  itemBatchSize: number;
  now: Date;
  stats: PriceAlertSweepStats;
  shouldContinue?: () => boolean;
  logger?: RunPriceAlertSweepInput["logger"];
}): Promise<ProductPageResult> => {
  let products: ScanProduct[];
  try {
    products = (await input.client.product.findMany({
      where: { id: { in: input.productIds } },
      select: { id: true, name: true, price: true, quantity: true, isActive: true },
    })) as ScanProduct[];
  } catch (error) {
    input.stats.errors += 1;
    input.logger?.error({ error, productIds: input.productIds }, "price alert product page failed");
    return "BATCH_ERROR";
  }

  input.stats.productsScanned += input.productIds.length;
  const productById = new Map(products.map((product) => [product.id, product]));
  let lastItemId = 0;

  while (true) {
    if (input.shouldContinue && !input.shouldContinue()) return "LEASE_LOST";
    let watchedItems: WatchedItem[];
    try {
      watchedItems = (await input.client.wishlistItem.findMany({
        where: {
          productId: { in: input.productIds },
          alertMode: { not: null },
          id: { gt: lastItemId },
        },
        orderBy: { id: "asc" },
        take: input.itemBatchSize,
        select: {
          id: true,
          userId: true,
          productId: true,
          alertMode: true,
          targetPrice: true,
          referencePrice: true,
          includeFlashSale: true,
          alertVersion: true,
        },
      })) as WatchedItem[];
    } catch (error) {
      input.stats.errors += 1;
      input.logger?.error(
        { error, productIds: input.productIds, lastItemId },
        "price alert item page failed",
      );
      return "BATCH_ERROR";
    }
    if (watchedItems.length === 0) return "COMPLETED";
    lastItemId = watchedItems[watchedItems.length - 1].id;

    try {
      const snapshots = await resolveAlertPriceSnapshots(
        input.client,
        watchedItems.map((item) => ({
          wishlistItemId: item.id,
          userId: item.userId,
          productId: item.productId,
          includeFlashSale: env.FLASH_SALE_PRICE_ALERT_ENABLED && item.includeFlashSale,
        })),
        input.now,
      );

      for (const item of watchedItems) {
        input.stats.itemsEvaluated += 1;
        const product = productById.get(item.productId);
        const snapshot = snapshots.get(item.id);
        if (!product || !item.alertMode) continue;
        if (!snapshot) {
          input.stats.invalidStatesSkipped += 1;
          continue;
        }
        if (!snapshot.purchasable) continue;
        const decision = evaluatePriceAlert({
          mode: item.alertMode,
          referencePrice: item.referencePrice,
          targetPrice: item.targetPrice,
          currentPrice: snapshot.effectivePrice,
        });
        if (!decision.triggered) {
          if (decision.reason === "INVALID_STATE") input.stats.invalidStatesSkipped += 1;
          continue;
        }
        if (item.referencePrice === null) {
          input.stats.invalidStatesSkipped += 1;
          continue;
        }
        try {
          const result = await commitPriceAlertCandidate(
            input.client,
            {
              wishlistItemId: item.id,
              userId: item.userId,
              productId: item.productId,
              productName: product.name,
              mode: item.alertMode,
              referencePrice: item.referencePrice,
              targetPrice: item.targetPrice,
              stablePrice: snapshot.stablePrice,
              currentPrice: snapshot.effectivePrice,
              source: snapshot.source,
              promotionId: snapshot.promotionId,
              pricingVersion: snapshot.pricingVersion,
              validUntil: snapshot.validUntil,
              alertVersion: item.alertVersion,
              includeFlashSale: item.includeFlashSale,
            },
            input.now,
          );
          if (result === "created") input.stats.notificationsCreated += 1;
          if (result === "duplicate") input.stats.duplicatesSkipped += 1;
        } catch (error) {
          input.stats.errors += 1;
          input.logger?.error(
            { error, wishlistItemId: item.id, productId: item.productId },
            "price alert candidate failed",
          );
        }
      }
    } catch (error) {
      input.stats.errors += 1;
      input.logger?.error(
        { error, productIds: input.productIds, lastItemId },
        "price alert snapshot page failed",
      );
      return "BATCH_ERROR";
    }
  }
};

export const runPriceAlertSweep = async (
  input: RunPriceAlertSweepInput,
): Promise<PriceAlertSweepResult> => {
  const stats = emptyStats();
  const itemBatchSize = input.itemBatchSize ?? input.productBatchSize;
  let cursor = input.startAfterProductId ?? 0;

  while (true) {
    if (input.shouldContinue && !input.shouldContinue()) {
      return { stats, lastProductId: cursor, completed: false, stopReason: "LEASE_LOST" };
    }

    let rows: Array<{ productId: number }>;
    try {
      rows = await input.client.wishlistItem.groupBy({
        by: ["productId"],
        where: { alertMode: { not: null }, productId: { gt: cursor } },
        orderBy: { productId: "asc" },
        take: input.productBatchSize,
      });
    } catch (error) {
      stats.errors += 1;
      input.logger?.error({ error, cursor }, "price alert product discovery failed");
      return { stats, lastProductId: cursor, completed: false, stopReason: "BATCH_ERROR" };
    }

    const productIds = rows.map((row) => row.productId);
    if (productIds.length === 0) {
      return { stats, lastProductId: cursor, completed: true, stopReason: "COMPLETED" };
    }

    const pageResult = await evaluateProductPage({
      client: input.client,
      productIds,
      itemBatchSize,
      now: input.now,
      stats,
      shouldContinue: input.shouldContinue,
      logger: input.logger,
    });
    const lastProductId = productIds[productIds.length - 1];
    if (pageResult === "LEASE_LOST") {
      return { stats, lastProductId: cursor, completed: false, stopReason: "LEASE_LOST" };
    }
    if (pageResult === "BATCH_ERROR") {
      return { stats, lastProductId: cursor, completed: false, stopReason: "BATCH_ERROR" };
    }

    if (input.onProductBatchComplete) {
      try {
        const accepted = await input.onProductBatchComplete(lastProductId, stats);
        if (!accepted) {
          return { stats, lastProductId, completed: false, stopReason: "CHECKPOINT_REJECTED" };
        }
      } catch (error) {
        stats.errors += 1;
        input.logger?.error({ error, lastProductId }, "price alert checkpoint callback failed");
        return { stats, lastProductId: cursor, completed: false, stopReason: "BATCH_ERROR" };
      }
    }
    cursor = lastProductId;
  }
};

export const evaluatePricingEvent = async (
  client: typeof prisma,
  event: { productIds?: number[] },
  now: Date,
  productBatchSize: number,
  itemBatchSize = productBatchSize,
): Promise<PriceAlertSweepStats> => {
  const productIds = [
    ...new Set((event.productIds ?? []).filter((id) => Number.isInteger(id) && id > 0)),
  ].sort((a, b) => a - b);
  const stats = emptyStats();
  for (const ids of chunk(productIds, productBatchSize)) {
    const result = await evaluateProductPage({
      client,
      productIds: ids,
      itemBatchSize,
      now,
      stats,
    });
    if (result !== "COMPLETED") break;
  }
  return stats;
};
