import { automaticDiscountPerUnit } from "modules/promotions/promotion-discount";
import {
  resolveAutomaticPromotionAt,
  type AutomaticPromotionCandidate,
} from "modules/promotions/automatic-promotion-policy";
import { selectProductPromotion } from "modules/promotions/promotion-selection";
import type {
  ProductPromotionResolution,
  PromotionResolutionContext,
  PromotionResolutionLine,
  ResolvedAutomaticPromotion,
  ResolvedPromotion,
} from "modules/promotions/promotions.types";

export type PrismaClientLike = {
  promotion: { findMany: (args: unknown) => Promise<unknown[]> };
};

export type {
  ProductPromotionResolution,
  PromotionResolutionContext,
  PromotionResolutionLine,
  ResolvedAutomaticPromotion,
  ResolvedFlashSale,
  ResolvedPromotion,
} from "modules/promotions/promotions.types";

type PromotionRow = {
  id: number;
  name: string;
  discountKind: "PERCENT" | "FIXED";
  discountValue: number;
  pricingVersion: number;
  startsAt: Date;
  endsAt: Date;
  automaticPolicy: { priority: number; stackableWithCoupon: boolean } | null;
  flashSalePolicy: {
    priority: number;
    stackableWithCoupon: boolean;
    showRemainingQuota: boolean;
    quotas: Array<{
      productId: number;
      totalQuota: number;
      claimedUnits: number;
      maxUnitsPerUser: number;
      product?: { price: number };
      usages?: Array<{ userId: number; claimedUnits: number }>;
    }>;
  } | null;
  products: Array<{ productId: number; product?: { price: number } }>;
};

const normalizeLines = (lines: PromotionResolutionLine[]): PromotionResolutionLine[] => {
  const quantities = new Map<number, number>();
  for (const line of lines) {
    quantities.set(line.productId, (quantities.get(line.productId) ?? 0) + line.quantity);
  }
  return [...quantities.entries()]
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((a, b) => a.productId - b.productId);
};

const hasExactUserContext = (context: PromotionResolutionContext) =>
  context.eligibilityMode === "EXACT" && context.userId !== undefined;

const promotionQuery = (productIds: number[], context: PromotionResolutionContext) => ({
  where: {
    kind: { in: ["AUTOMATIC", "FLASH_SALE"] },
    state: "ACTIVE",
    startsAt: { lte: context.now },
    endsAt: { gt: context.now },
    OR: [
      { products: { some: { productId: { in: productIds } } } },
      { flashSalePolicy: { quotas: { some: { productId: { in: productIds } } } } },
    ],
  },
  include: {
    automaticPolicy: true,
    products: {
      where: { productId: { in: productIds } },
      select: { productId: true, product: { select: { price: true } } },
    },
    flashSalePolicy: {
      include: {
        quotas: {
          where: { productId: { in: productIds } },
          include: {
            product: { select: { price: true } },
            ...(!hasExactUserContext(context)
              ? {}
              : { usages: { where: { userId: context.userId } } }),
          },
        },
      },
    },
  },
});

const candidatesFromRows = (rows: PromotionRow[], context: PromotionResolutionContext) => {
  const candidatesByProduct = new Map<number, ResolvedPromotion[]>();
  const add = (productId: number, candidate: ResolvedPromotion) => {
    const candidates = candidatesByProduct.get(productId) ?? [];
    candidates.push(candidate);
    candidatesByProduct.set(productId, candidates);
  };

  for (const row of rows) {
    if (row.automaticPolicy) {
      const candidate = {
        id: row.id,
        name: row.name,
        discountKind: row.discountKind,
        discountValue: row.discountValue,
        priority: row.automaticPolicy.priority,
        stackableWithCoupon: row.automaticPolicy.stackableWithCoupon,
        pricingVersion: row.pricingVersion,
      };
      for (const target of row.products) {
        const listPrice = target.product?.price ?? Number.MAX_SAFE_INTEGER;
        add(target.productId, {
          ...candidate,
          kind: "AUTOMATIC",
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          unitDiscount: automaticDiscountPerUnit(candidate, listPrice),
        });
      }
    }
    if (row.flashSalePolicy) {
      for (const quota of row.flashSalePolicy.quotas) {
        const listPrice = quota.product?.price ?? Number.MAX_SAFE_INTEGER;
        const userClaimedUnits = hasExactUserContext(context)
          ? (quota.usages?.[0]?.claimedUnits ?? 0)
          : undefined;
        const candidate = {
          id: row.id,
          name: row.name,
          discountKind: row.discountKind,
          discountValue: row.discountValue,
          priority: row.flashSalePolicy.priority,
          stackableWithCoupon: row.flashSalePolicy.stackableWithCoupon,
          pricingVersion: row.pricingVersion,
        };
        add(quota.productId, {
          ...candidate,
          kind: "FLASH_SALE",
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          unitDiscount: automaticDiscountPerUnit(candidate, listPrice),
          totalQuota: quota.totalQuota,
          claimedUnits: quota.claimedUnits,
          remainingQuota: Math.max(0, quota.totalQuota - quota.claimedUnits),
          maxUnitsPerUser: quota.maxUnitsPerUser,
          showRemainingQuota: row.flashSalePolicy.showRemainingQuota,
          ...(userClaimedUnits === undefined
            ? {}
            : {
                userClaimedUnits,
                userRemainingQuota: Math.max(0, quota.maxUnitsPerUser - userClaimedUnits),
              }),
        });
      }
    }
  }
  return candidatesByProduct;
};

export const resolveProductPromotions = async (
  client: PrismaClientLike,
  lines: PromotionResolutionLine[],
  context: PromotionResolutionContext,
): Promise<Map<number, ProductPromotionResolution>> => {
  const normalizedLines = normalizeLines(lines);
  if (normalizedLines.length === 0) return new Map();
  const productIds = normalizedLines.map((line) => line.productId);
  const rows = ((await client.promotion.findMany(promotionQuery(productIds, context))) ??
    []) as PromotionRow[];
  const candidatesByProduct = candidatesFromRows(rows, context);
  const result = new Map<number, ProductPromotionResolution>();
  for (const line of normalizedLines) {
    result.set(
      line.productId,
      selectProductPromotion(candidatesByProduct.get(line.productId) ?? [], line, context),
    );
  }
  return result;
};

export const resolveAutomaticPromotions = async (
  client: PrismaClientLike,
  productIds: number[],
  now: Date,
): Promise<Map<number, ResolvedAutomaticPromotion>> => {
  const ids = [...new Set(productIds)].sort((a, b) => a - b);
  if (ids.length === 0) return new Map();
  const rows = ((await client.promotion.findMany({
    where: {
      kind: "AUTOMATIC",
      state: "ACTIVE",
      startsAt: { lte: now },
      endsAt: { gt: now },
      products: { some: { productId: { in: ids } } },
    },
    include: {
      automaticPolicy: true,
      products: {
        where: { productId: { in: ids } },
        select: { productId: true, product: { select: { price: true } } },
      },
    },
  })) ?? []) as PromotionRow[];
  const candidatesByProduct = new Map<number, AutomaticPromotionCandidate[]>();
  for (const row of rows) {
    if (!row.automaticPolicy) continue;
    for (const target of row.products) {
      const candidates = candidatesByProduct.get(target.productId) ?? [];
      candidates.push({
        id: row.id,
        name: row.name,
        discountKind: row.discountKind,
        discountValue: row.discountValue,
        priority: row.automaticPolicy.priority,
        stackableWithCoupon: row.automaticPolicy.stackableWithCoupon,
        pricingVersion: row.pricingVersion,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
      });
      candidatesByProduct.set(target.productId, candidates);
    }
  }
  const result = new Map<number, ResolvedAutomaticPromotion>();
  for (const productId of ids) {
    const product = rows
      .flatMap((row) => row.products)
      .find((target) => target.productId === productId);
    const winner = resolveAutomaticPromotionAt(
      candidatesByProduct.get(productId) ?? [],
      product?.product?.price ?? Number.MAX_SAFE_INTEGER,
      now,
    );
    if (winner) result.set(productId, winner);
  }
  return result;
};
