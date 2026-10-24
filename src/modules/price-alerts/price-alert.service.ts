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

export type RunPriceAlertSweepInput = {
  client: typeof prisma;
  now: Date;
  productBatchSize: number;
  logger?: {
    warn: (fields: unknown, message: string) => void;
    error: (fields: unknown, message: string) => void;
  };
  shouldContinue?: () => boolean;
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

export const runPriceAlertSweep = async (input: RunPriceAlertSweepInput) => {
  const { client, now, productBatchSize } = input;
  const stats: PriceAlertSweepStats = {
    productsScanned: 0,
    itemsEvaluated: 0,
    notificationsCreated: 0,
    duplicatesSkipped: 0,
    invalidStatesSkipped: 0,
    errors: 0,
  };
  const watched = await client.wishlistItem.findMany({
    where: { alertMode: { not: null } },
    select: { productId: true },
    distinct: ["productId"],
    orderBy: { productId: "asc" },
  });
  const productIds = [...new Set(watched.map((row) => row.productId))].sort((a, b) => a - b);

  for (const ids of chunk(productIds, productBatchSize)) {
    if (input.shouldContinue && !input.shouldContinue()) break;
    try {
      const [products, items] = await Promise.all([
        client.product.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, price: true, quantity: true, isActive: true },
        }),
        client.wishlistItem.findMany({
          where: { productId: { in: ids }, alertMode: { not: null } },
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
        }),
      ]);
      stats.productsScanned += ids.length;
      const productById = new Map(
        (products as ScanProduct[]).map((product) => [product.id, product]),
      );
      const watchedItems = items as WatchedItem[];
      const snapshots = await resolveAlertPriceSnapshots(
        client,
        watchedItems.map((item) => ({
          wishlistItemId: item.id,
          userId: item.userId,
          productId: item.productId,
          includeFlashSale: env.FLASH_SALE_PRICE_ALERT_ENABLED && item.includeFlashSale,
        })),
        now,
      );

      for (const item of watchedItems) {
        stats.itemsEvaluated += 1;
        const product = productById.get(item.productId);
        const snapshot = snapshots.get(item.id);
        if (!product || !item.alertMode) continue;
        if (!snapshot) {
          stats.invalidStatesSkipped += 1;
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
          if (decision.reason === "INVALID_STATE") stats.invalidStatesSkipped += 1;
          continue;
        }
        if (item.referencePrice === null) {
          stats.invalidStatesSkipped += 1;
          continue;
        }
        try {
          const result = await commitPriceAlertCandidate(
            client,
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
            now,
          );
          if (result === "created") stats.notificationsCreated += 1;
          if (result === "duplicate") stats.duplicatesSkipped += 1;
        } catch (error) {
          stats.errors += 1;
          input.logger?.error(
            { error, wishlistItemId: item.id, productId: item.productId },
            "price alert candidate failed",
          );
        }
      }
    } catch (error) {
      stats.errors += 1;
      input.logger?.error({ error, productIds: ids }, "price alert batch failed");
    }
  }
  return stats;
};

export const evaluatePricingEvent = async (
  client: typeof prisma,
  _event: { productIds?: number[] },
  now: Date,
  productBatchSize: number,
) =>
  runPriceAlertSweep({
    client,
    now,
    productBatchSize,
  });
