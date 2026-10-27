import { automaticDiscountPerUnit } from "modules/promotions/promotion-discount";
import { comparePromotionCandidates } from "modules/promotions/promotion-selection";
import type {
  AutomaticPromotionInput,
  ResolvedAutomaticPromotion,
} from "modules/promotions/promotions.types";

export type AutomaticPromotionCandidate = AutomaticPromotionInput & {
  startsAt: Date;
  endsAt: Date;
};

export { automaticDiscountPerUnit } from "modules/promotions/promotion-discount";

export const resolveAutomaticPromotionAt = (
  candidates: readonly AutomaticPromotionCandidate[],
  listPrice: number,
  asOf: Date,
): ResolvedAutomaticPromotion | null => {
  const active = candidates
    .filter((candidate) => candidate.startsAt <= asOf && asOf < candidate.endsAt)
    .map(
      (candidate) =>
        ({
          ...candidate,
          kind: "AUTOMATIC",
          unitDiscount: automaticDiscountPerUnit(candidate, listPrice),
        }) as const,
    )
    .sort((a, b) => comparePromotionCandidates(a, b, listPrice));
  const winner = active[0];
  if (!winner) return null;
  return {
    id: winner.id,
    name: winner.name,
    discountKind: winner.discountKind,
    discountValue: winner.discountValue,
    priority: winner.priority,
    stackableWithCoupon: winner.stackableWithCoupon,
    pricingVersion: winner.pricingVersion,
    kind: "AUTOMATIC",
    startsAt: winner.startsAt,
    endsAt: winner.endsAt,
    unitDiscount: winner.unitDiscount ?? 0,
  };
};
