import { Product } from "@prisma/client";
import { prisma } from "config/client";
import { isUniqueViolation } from "lib/errors";
import { evaluatePriceAlert } from "modules/price-alerts/price-alert.policy";
import { resolveAutomaticPromotions } from "modules/promotions/promotion-resolver";

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
};

export type PriceAlertCandidate = {
  wishlistItemId: number;
  userId: number;
  productId: number;
  productName: string;
  mode: "PERCENT_DROP" | "TARGET_PRICE";
  referencePrice: number;
  targetPrice: number | null;
  currentPrice: number;
};

class StaleAlertConfiguration extends Error {}

const chunk = <T>(items: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    chunks.push(items.slice(index, index + size));
  return chunks;
};

const notificationContent = (candidate: PriceAlertCandidate) =>
  candidate.mode === "TARGET_PRICE"
    ? {
        title: "Sản phẩm yêu thích đã đạt giá mục tiêu",
        message: `${candidate.productName} đã đạt mức giá mục tiêu ${candidate.targetPrice}đ.`,
      }
    : {
        title: "Sản phẩm yêu thích vừa giảm giá",
        message: `${candidate.productName} đã giảm từ ${candidate.referencePrice}đ xuống ${candidate.currentPrice}đ.`,
      };

export const commitPriceAlertCandidate = async (
  client: typeof prisma,
  candidate: PriceAlertCandidate,
  now: Date,
): Promise<"created" | "duplicate" | "stale"> => {
  try {
    await client.$transaction(async (tx) => {
      const content = notificationContent(candidate);
      await tx.notification.create({
        data: {
          userId: candidate.userId,
          productId: candidate.productId,
          type: "PRICE_DROP",
          title: content.title,
          message: content.message,
          oldPrice: candidate.referencePrice,
          newPrice: candidate.currentPrice,
          dedupeKey: `price-drop:${candidate.wishlistItemId}:${candidate.referencePrice}:${candidate.currentPrice}`,
        },
      });

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
              referencePrice: candidate.currentPrice,
              lastAlertMode: "PERCENT_DROP" as const,
              lastAlertedPrice: candidate.currentPrice,
              lastAlertedAt: now,
            };
      const updated = await tx.wishlistItem.updateMany({
        where: {
          id: candidate.wishlistItemId,
          alertMode: candidate.mode,
          referencePrice: candidate.referencePrice,
        },
        data,
      });
      if (updated.count !== 1) throw new StaleAlertConfiguration();
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
};

type ScanProduct = Pick<Product, "id" | "name" | "price" | "quantity" | "isActive">;

export const runPriceAlertSweep = async ({
  client,
  now,
  productBatchSize,
}: RunPriceAlertSweepInput) => {
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
          },
        }),
      ]);
      stats.productsScanned += ids.length;
      const productById = new Map(
        (products as ScanProduct[]).map((product) => [product.id, product]),
      );
      const eligibleIds = (products as ScanProduct[])
        .filter((product) => product.isActive && product.quantity > 0)
        .map((product) => product.id);
      const promotions = await resolveAutomaticPromotions(client, eligibleIds, now);

      for (const item of items as WatchedItem[]) {
        stats.itemsEvaluated += 1;
        const product = productById.get(item.productId);
        if (!product || !product.isActive || product.quantity <= 0 || !item.alertMode) continue;
        const promotion = promotions.get(item.productId) ?? null;
        const currentPrice = product.price - (promotion?.unitDiscount ?? 0);
        const decision = evaluatePriceAlert({
          mode: item.alertMode,
          referencePrice: item.referencePrice,
          targetPrice: item.targetPrice,
          currentPrice,
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
              currentPrice,
            },
            now,
          );
          if (result === "created") stats.notificationsCreated += 1;
          if (result === "duplicate") stats.duplicatesSkipped += 1;
        } catch {
          stats.errors += 1;
        }
      }
    } catch {
      stats.errors += 1;
    }
  }
  return stats;
};
