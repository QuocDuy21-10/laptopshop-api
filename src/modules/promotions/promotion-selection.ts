import { automaticDiscountPerUnit } from "modules/promotions/promotion-pricing";
import type {
  FlashSaleFallback,
  ProductPromotionResolution,
  PromotionPricingCandidate,
  PromotionResolutionContext,
  PromotionResolutionLine,
  PublicPromotionFallback,
  ResolvedPromotion,
} from "modules/promotions/promotions.types";

export const comparePromotionCandidates = (
  a: PromotionPricingCandidate,
  b: PromotionPricingCandidate,
  listPrice: number,
): number => {
  const priority = b.priority - a.priority;
  if (priority !== 0) return priority;
  const discount =
    (b.unitDiscount ?? automaticDiscountPerUnit(b, listPrice)) -
    (a.unitDiscount ?? automaticDiscountPerUnit(a, listPrice));
  return discount !== 0 ? discount : a.id - b.id;
};

const isInWindow = (promotion: ResolvedPromotion, now: Date) =>
  promotion.startsAt <= now && now < promotion.endsAt;

export const selectProductPromotion = (
  candidates: ResolvedPromotion[],
  line: PromotionResolutionLine,
  context: PromotionResolutionContext,
): ProductPromotionResolution => {
  const sorted = [...candidates].sort((a, b) =>
    comparePromotionCandidates(a, b, Number.MAX_SAFE_INTEGER),
  );
  let skipped: FlashSaleFallback | null = null;

  for (const candidate of sorted) {
    if (!isInWindow(candidate, context.now)) continue;
    if (candidate.kind !== "FLASH_SALE") {
      return {
        winner: candidate,
        eligibility: context.eligibilityMode,
        fallback: skipped ? { ...skipped, appliedPromotionKind: "AUTOMATIC" } : null,
      };
    }

    const globalRemaining = Math.max(0, candidate.remainingQuota);
    const hasUserLimit = context.eligibilityMode === "EXACT" && context.userId !== undefined;
    const userRemaining = hasUserLimit ? Math.max(0, candidate.userRemainingQuota ?? 0) : undefined;
    const globalShort = globalRemaining < line.quantity;
    const userShort = userRemaining !== undefined && userRemaining < line.quantity;
    if (!globalShort && !userShort) {
      return { winner: candidate, eligibility: context.eligibilityMode, fallback: null };
    }

    if (!skipped) {
      skipped = {
        promotionId: candidate.id,
        reason:
          globalShort && userShort
            ? "GLOBAL_AND_USER_QUOTA"
            : globalShort
              ? "GLOBAL_QUOTA"
              : "USER_QUOTA",
        requestedQuantity: line.quantity,
        globalRemaining,
        ...(userRemaining === undefined ? {} : { userRemaining }),
        availableQuantity:
          userRemaining === undefined ? globalRemaining : Math.min(globalRemaining, userRemaining),
        appliedPromotionKind: null,
      };
    }
  }

  return { winner: null, eligibility: context.eligibilityMode, fallback: skipped };
};

export const toPublicPromotionFallback = (
  fallback: FlashSaleFallback | null,
): PublicPromotionFallback | null =>
  fallback
    ? {
        skippedKind: "FLASH_SALE",
        promotionId: fallback.promotionId,
        reason: fallback.reason,
        requestedQuantity: fallback.requestedQuantity,
        availableQuantity: fallback.availableQuantity,
        appliedPromotionKind: fallback.appliedPromotionKind,
      }
    : null;
