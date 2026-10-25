import {
  automaticDiscountPerUnit,
  selectAutomaticPromotion,
} from "modules/promotions/promotion-pricing";
import type { AutomaticPromotionInput } from "modules/promotions/promotions.types";
import type {
  ResolvedAutomaticPromotion,
  ResolvedPromotion,
} from "modules/promotions/promotions.types";

export type PrismaClientLike = {
  promotion: {
    findMany: (args: unknown) => Promise<unknown[]>;
  };
};

export type {
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

const promotionQuery = (productIds: number[], now: Date, userId?: number) => ({
  where: {
    kind: { in: ["AUTOMATIC", "FLASH_SALE"] },
    state: "ACTIVE",
    startsAt: { lte: now },
    endsAt: { gt: now },
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
            ...(userId === undefined ? {} : { usages: { where: { userId } } }),
          },
        },
      },
    },
  },
});

export const resolveProductPromotions = async (
  client: PrismaClientLike,
  productIds: number[],
  now: Date,
  userId?: number,
): Promise<Map<number, ResolvedPromotion>> => {
  const ids = [...new Set(productIds)].sort((a, b) => a - b);
  if (ids.length === 0) return new Map();
  const rows = ((await client.promotion.findMany(promotionQuery(ids, now, userId))) ??
    []) as PromotionRow[];
  const candidatesByProduct = new Map<
    number,
    Array<{
      candidate: AutomaticPromotionInput;
      listPrice: number;
      resolved: ResolvedPromotion;
    }>
  >();

  const addCandidate = (
    productId: number,
    candidate: AutomaticPromotionInput,
    listPrice: number,
    resolved: ResolvedPromotion,
  ) => {
    const list = candidatesByProduct.get(productId) ?? [];
    list.push({ candidate, listPrice, resolved });
    candidatesByProduct.set(productId, list);
  };

  for (const row of rows) {
    if (row.automaticPolicy) {
      const candidate: AutomaticPromotionInput = {
        id: row.id,
        name: row.name,
        discountKind: row.discountKind,
        discountValue: row.discountValue,
        priority: row.automaticPolicy.priority,
        stackableWithCoupon: row.automaticPolicy.stackableWithCoupon,
        pricingVersion: row.pricingVersion,
      };
      for (const target of row.products) {
        addCandidate(
          target.productId,
          candidate,
          target.product?.price ?? Number.MAX_SAFE_INTEGER,
          {
            ...candidate,
            kind: "AUTOMATIC",
            startsAt: row.startsAt,
            endsAt: row.endsAt,
            unitDiscount: automaticDiscountPerUnit(
              candidate,
              target.product?.price ?? Number.MAX_SAFE_INTEGER,
            ),
          },
        );
      }
    }
    if (row.flashSalePolicy) {
      for (const quota of row.flashSalePolicy.quotas) {
        const candidate: AutomaticPromotionInput = {
          id: row.id,
          name: row.name,
          discountKind: row.discountKind,
          discountValue: row.discountValue,
          priority: row.flashSalePolicy.priority,
          stackableWithCoupon: row.flashSalePolicy.stackableWithCoupon,
          pricingVersion: row.pricingVersion,
        };
        const listPrice = quota.product?.price ?? Number.MAX_SAFE_INTEGER;
        const userClaimedUnits =
          userId === undefined ? undefined : (quota.usages?.[0]?.claimedUnits ?? 0);
        addCandidate(quota.productId, candidate, listPrice, {
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

  const result = new Map<number, ResolvedPromotion>();
  for (const productId of ids) {
    const candidates = candidatesByProduct.get(productId) ?? [];
    const winner = selectAutomaticPromotion(
      candidates.map(({ candidate }) => candidate),
      candidates[0]?.listPrice ?? Number.MAX_SAFE_INTEGER,
    );
    if (!winner) continue;
    const resolved = candidates.find(({ candidate }) => candidate.id === winner.id)?.resolved;
    if (resolved) result.set(productId, resolved);
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
  const candidatesByProduct = new Map<
    number,
    Array<{ candidate: AutomaticPromotionInput; listPrice: number }>
  >();
  for (const row of rows) {
    if (!row.automaticPolicy) continue;
    const candidate: AutomaticPromotionInput = {
      id: row.id,
      name: row.name,
      discountKind: row.discountKind,
      discountValue: row.discountValue,
      priority: row.automaticPolicy.priority,
      stackableWithCoupon: row.automaticPolicy.stackableWithCoupon,
      pricingVersion: row.pricingVersion,
    };
    for (const target of row.products) {
      const list = candidatesByProduct.get(target.productId) ?? [];
      list.push({ candidate, listPrice: target.product?.price ?? Number.MAX_SAFE_INTEGER });
      candidatesByProduct.set(target.productId, list);
    }
  }

  const result = new Map<number, ResolvedAutomaticPromotion>();
  for (const productId of ids) {
    const candidates = candidatesByProduct.get(productId) ?? [];
    const winner = selectAutomaticPromotion(
      candidates.map(({ candidate }) => candidate),
      candidates[0]?.listPrice ?? Number.MAX_SAFE_INTEGER,
    );
    if (!winner) continue;
    const row = rows.find((candidate) => candidate.id === winner.id)!;
    const listPrice =
      candidates.find(({ candidate }) => candidate.id === winner.id)?.listPrice ??
      Number.MAX_SAFE_INTEGER;
    result.set(productId, {
      ...winner,
      kind: "AUTOMATIC",
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      unitDiscount: automaticDiscountPerUnit(winner, listPrice),
    });
  }
  return result;
};
