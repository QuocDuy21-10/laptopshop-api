import {
  resolveAutomaticPromotionAt,
  type AutomaticPromotionCandidate,
} from "modules/promotions/automatic-promotion-policy";

export const CATALOG_PRICE_POLICY_VERSION = 1;
// first persisted window opens here so reads with an asOf just before a refresh still resolve
export const CATALOG_PRICE_WINDOW_FLOOR = new Date("1970-01-01T00:00:00.000Z");

export type CatalogPriceWindowDraft = {
  validFrom: Date;
  validUntil: Date | null;
  source: "LIST_PRICE" | "AUTOMATIC";
  listPrice: number;
  effectiveCatalogPrice: number;
  automaticPromotionId: number | null;
  promotionPricingVersion: number | null;
  policyVersion: number;
};

const sameWindowValue = (left: CatalogPriceWindowDraft, right: CatalogPriceWindowDraft) =>
  left.source === right.source &&
  left.listPrice === right.listPrice &&
  left.effectiveCatalogPrice === right.effectiveCatalogPrice &&
  left.automaticPromotionId === right.automaticPromotionId &&
  left.promotionPricingVersion === right.promotionPricingVersion &&
  left.policyVersion === right.policyVersion;

export const buildCatalogPriceTimeline = (input: {
  listPrice: number;
  candidates: readonly AutomaticPromotionCandidate[];
  now: Date;
}): CatalogPriceWindowDraft[] => {
  const boundaries = [
    input.now.getTime(),
    ...input.candidates.flatMap((candidate) =>
      [candidate.startsAt.getTime(), candidate.endsAt.getTime()].filter(
        (time) => time > input.now.getTime(),
      ),
    ),
  ].sort((a, b) => a - b);
  const uniqueBoundaries = [...new Set(boundaries)];
  const windows: CatalogPriceWindowDraft[] = [];
  for (let index = 0; index < uniqueBoundaries.length; index += 1) {
    const validFrom = new Date(uniqueBoundaries[index]);
    const nextBoundary = uniqueBoundaries[index + 1];
    const validUntil = nextBoundary === undefined ? null : new Date(nextBoundary);
    const winner = resolveAutomaticPromotionAt(input.candidates, input.listPrice, validFrom);
    const current: CatalogPriceWindowDraft = winner
      ? {
          validFrom,
          validUntil,
          source: "AUTOMATIC",
          listPrice: input.listPrice,
          effectiveCatalogPrice: Math.max(0, input.listPrice - winner.unitDiscount),
          automaticPromotionId: winner.id,
          promotionPricingVersion: winner.pricingVersion,
          policyVersion: CATALOG_PRICE_POLICY_VERSION,
        }
      : {
          validFrom,
          validUntil,
          source: "LIST_PRICE",
          listPrice: input.listPrice,
          effectiveCatalogPrice: input.listPrice,
          automaticPromotionId: null,
          promotionPricingVersion: null,
          policyVersion: CATALOG_PRICE_POLICY_VERSION,
        };
    const previous = windows.at(-1);
    if (
      previous &&
      previous.validUntil?.getTime() === current.validFrom.getTime() &&
      sameWindowValue(previous, current)
    ) {
      previous.validUntil = current.validUntil;
    } else {
      windows.push(current);
    }
  }
  return windows;
};
