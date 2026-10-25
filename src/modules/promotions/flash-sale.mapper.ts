import { effectivePromotionState } from "modules/promotions/promotions.mapper";

export type FlashSaleAvailabilityDto = {
  productId: number;
  promotionId: number;
  name: string;
  state: "SCHEDULED" | "RUNNING";
  available: boolean;
  remainingQuota: number | null;
  maxUnitsPerUser: number;
  userRemainingQuota?: number;
  startsAt: Date;
  endsAt: Date;
};

export const isFlashSaleAvailabilityEligible = (input: {
  quota: { totalQuota: number; claimedUnits: number; maxUnitsPerUser: number };
  userClaimedUnits?: number;
  userId?: number;
}) =>
  input.quota.totalQuota - input.quota.claimedUnits > 0 &&
  (input.userId === undefined || input.quota.maxUnitsPerUser - (input.userClaimedUnits ?? 0) > 0);

export const toFlashSaleAvailabilityDto = (input: {
  promotion: { id: number; name: string; state: "ACTIVE"; startsAt: Date; endsAt: Date };
  quota: { productId: number; totalQuota: number; claimedUnits: number; maxUnitsPerUser: number };
  userClaimedUnits?: number;
  userId?: number;
  showRemainingQuota: boolean;
  now: Date;
}): FlashSaleAvailabilityDto => {
  const state = effectivePromotionState(
    input.promotion.state,
    input.promotion.startsAt,
    input.promotion.endsAt,
    input.now,
  );
  const remainingQuota = Math.max(0, input.quota.totalQuota - input.quota.claimedUnits);
  const userRemainingQuota =
    input.userId === undefined
      ? undefined
      : Math.max(0, input.quota.maxUnitsPerUser - (input.userClaimedUnits ?? 0));
  return {
    productId: input.quota.productId,
    promotionId: input.promotion.id,
    name: input.promotion.name,
    state: state === "SCHEDULED" || state === "RUNNING" ? state : "RUNNING",
    available: isFlashSaleAvailabilityEligible(input),
    remainingQuota: input.showRemainingQuota ? remainingQuota : null,
    maxUnitsPerUser: input.quota.maxUnitsPerUser,
    ...(userRemainingQuota === undefined ? {} : { userRemainingQuota }),
    startsAt: input.promotion.startsAt,
    endsAt: input.promotion.endsAt,
  };
};
