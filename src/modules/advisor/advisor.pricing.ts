import { prisma } from "config/client";
import type { AdvisorCandidate, PricedAdvisorCandidate } from "modules/advisor/advisor.schema";
import { resolveAutomaticPromotions } from "modules/promotions/promotion-resolver";

export const priceAdvisorCandidates = async (
  candidates: AdvisorCandidate[],
  now: Date,
): Promise<PricedAdvisorCandidate[]> => {
  const promotions = await resolveAutomaticPromotions(
    prisma,
    candidates.map(({ id }) => id),
    now,
  );
  return candidates.map((product) => {
    const automaticPromotion = promotions.get(product.id) ?? null;
    return {
      product,
      effectivePrice: Math.max(0, product.price - (automaticPromotion?.unitDiscount ?? 0)),
      automaticPromotion,
    };
  });
};
