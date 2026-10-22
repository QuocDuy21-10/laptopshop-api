import {
  automaticDiscountPerUnit,
  selectAutomaticPromotion,
} from "modules/promotions/promotion-pricing";
import type { AutomaticPromotionInput } from "modules/promotions/promotions.types";

export type PrismaClientLike = {
  promotion: {
    findMany: (args: unknown) => Promise<unknown[]>;
  };
};

export type ResolvedAutomaticPromotion = AutomaticPromotionInput & {
  endsAt: Date;
  unitDiscount: number;
};

type PromotionRow = {
  id: number;
  name: string;
  discountKind: "PERCENT" | "FIXED";
  discountValue: number;
  pricingVersion: number;
  startsAt: Date;
  endsAt: Date;
  automaticPolicy: { priority: number; stackableWithCoupon: boolean } | null;
  products: Array<{ productId: number; product?: { price: number } }>;
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
      endsAt: row.endsAt,
      unitDiscount: automaticDiscountPerUnit(winner, listPrice),
    });
  }
  return result;
};
