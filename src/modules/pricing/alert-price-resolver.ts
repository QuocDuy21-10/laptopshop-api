import {
  automaticDiscountPerUnit,
  selectAutomaticPromotion,
} from "modules/promotions/promotion-pricing";
import type { AutomaticPromotionInput } from "modules/promotions/promotions.types";
import type { ResolvedPromotion } from "modules/promotions/promotion-resolver";

export type AlertPriceRequest = {
  wishlistItemId: number;
  userId: number;
  productId: number;
  includeFlashSale: boolean;
};

export type PriceSnapshot = {
  productId: number;
  listPrice: number;
  stablePrice: number;
  effectivePrice: number;
  source: "LIST_PRICE" | "AUTOMATIC" | "FLASH_SALE";
  promotionId: number | null;
  pricingVersion: number | null;
  validUntil: Date | null;
  purchasable: boolean;
};

type AlertPrismaClientLike = {
  product: {
    findMany: (args: unknown) => Promise<unknown[]>;
  };
  promotion: {
    findMany: (args: unknown) => Promise<unknown[]>;
  };
};

type ProductRow = {
  id: number;
  price: number;
  quantity: number;
  isActive: boolean;
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

type Candidate = {
  candidate: AutomaticPromotionInput;
  listPrice: number;
  resolved: ResolvedPromotion;
};

const promotionQuery = (productIds: number[], userIds: number[], now: Date) => ({
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
            usages: { where: { userId: { in: userIds } } },
          },
        },
      },
    },
  },
});

const selectWinner = (candidates: Candidate[], listPrice: number) => {
  const winner = selectAutomaticPromotion(
    candidates.map(({ candidate }) => candidate),
    listPrice,
  );
  if (!winner) return null;
  return candidates.find(({ candidate }) => candidate.id === winner.id)?.resolved ?? null;
};

const addCandidate = (
  candidatesByRequest: Map<number, Candidate[]>,
  requestId: number,
  candidate: AutomaticPromotionInput,
  listPrice: number,
  resolved: ResolvedPromotion,
) => {
  const candidates = candidatesByRequest.get(requestId) ?? [];
  candidates.push({ candidate, listPrice, resolved });
  candidatesByRequest.set(requestId, candidates);
};

export const resolveAlertPriceSnapshots = async (
  client: AlertPrismaClientLike,
  requests: AlertPriceRequest[],
  now: Date,
): Promise<Map<number, PriceSnapshot>> => {
  const uniqueRequests = [
    ...new Map(requests.map((request) => [request.wishlistItemId, request])).values(),
  ];
  const productIds = [...new Set(uniqueRequests.map((request) => request.productId))].sort(
    (a, b) => a - b,
  );
  const userIds = [...new Set(uniqueRequests.map((request) => request.userId))].sort(
    (a, b) => a - b,
  );
  if (productIds.length === 0) return new Map();

  const [products, rows] = await Promise.all([
    client.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, price: true, quantity: true, isActive: true },
    }),
    client.promotion.findMany(promotionQuery(productIds, userIds, now)),
  ]);
  const productById = new Map((products as ProductRow[]).map((product) => [product.id, product]));
  const candidatesByRequest = new Map<number, Candidate[]>();

  for (const row of rows as PromotionRow[]) {
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
        const listPrice = target.product?.price ?? Number.MAX_SAFE_INTEGER;
        for (const request of uniqueRequests.filter(
          (item) => item.productId === target.productId,
        )) {
          addCandidate(candidatesByRequest, request.wishlistItemId, candidate, listPrice, {
            ...candidate,
            kind: "AUTOMATIC",
            startsAt: row.startsAt,
            endsAt: row.endsAt,
            unitDiscount: automaticDiscountPerUnit(candidate, listPrice),
          });
        }
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
        const remainingQuota = Math.max(0, quota.totalQuota - quota.claimedUnits);
        for (const request of uniqueRequests.filter(
          (item) => item.productId === quota.productId && item.includeFlashSale,
        )) {
          const userClaimedUnits =
            quota.usages?.find((usage) => usage.userId === request.userId)?.claimedUnits ?? 0;
          const userRemainingQuota = Math.max(0, quota.maxUnitsPerUser - userClaimedUnits);
          if (remainingQuota <= 0 || userRemainingQuota <= 0) continue;
          addCandidate(candidatesByRequest, request.wishlistItemId, candidate, listPrice, {
            ...candidate,
            kind: "FLASH_SALE",
            startsAt: row.startsAt,
            endsAt: row.endsAt,
            unitDiscount: automaticDiscountPerUnit(candidate, listPrice),
            totalQuota: quota.totalQuota,
            claimedUnits: quota.claimedUnits,
            remainingQuota,
            maxUnitsPerUser: quota.maxUnitsPerUser,
            showRemainingQuota: row.flashSalePolicy.showRemainingQuota,
            userClaimedUnits,
            userRemainingQuota,
          });
        }
      }
    }
  }

  const snapshots = new Map<number, PriceSnapshot>();
  for (const request of uniqueRequests) {
    const product = productById.get(request.productId);
    if (!product) continue;
    const candidates = candidatesByRequest.get(request.wishlistItemId) ?? [];
    const stableCandidates = candidates.filter(({ resolved }) => resolved.kind === "AUTOMATIC");
    const stablePromotion = selectWinner(stableCandidates, product.price);
    const effectivePromotion = selectWinner(candidates, product.price);
    const stablePrice = product.price - (stablePromotion?.unitDiscount ?? 0);
    const effectivePrice = product.price - (effectivePromotion?.unitDiscount ?? 0);
    const source = effectivePromotion?.kind ?? "LIST_PRICE";

    snapshots.set(request.wishlistItemId, {
      productId: product.id,
      listPrice: product.price,
      stablePrice,
      effectivePrice,
      source,
      promotionId: effectivePromotion?.id ?? null,
      pricingVersion: effectivePromotion?.pricingVersion ?? null,
      validUntil: effectivePromotion?.endsAt ?? null,
      purchasable: product.isActive && product.quantity > 0,
    });
  }
  return snapshots;
};
