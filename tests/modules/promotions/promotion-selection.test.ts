import {
  comparePromotionCandidates,
  selectProductPromotion,
  toPublicPromotionFallback,
} from "modules/promotions/promotion-selection";
import type {
  AutomaticPromotionInput,
  ResolvedPromotion,
  ResolvedFlashSale,
} from "modules/promotions/promotions.types";

const automatic = (overrides: Partial<AutomaticPromotionInput> = {}): ResolvedPromotion => ({
  id: 10,
  name: "Automatic",
  discountKind: "PERCENT",
  discountValue: 10,
  priority: 1,
  stackableWithCoupon: true,
  pricingVersion: 1,
  kind: "AUTOMATIC",
  startsAt: new Date("2026-01-01T00:00:00Z"),
  endsAt: new Date("2027-01-01T00:00:00Z"),
  unitDiscount: 10,
  ...overrides,
});

const flash = (overrides: Partial<ResolvedFlashSale> = {}): ResolvedFlashSale => ({
  ...automatic({ id: 20, name: "Flash", priority: 3, discountValue: 20 }),
  kind: "FLASH_SALE",
  totalQuota: 10,
  claimedUnits: 8,
  remainingQuota: 2,
  maxUnitsPerUser: 10,
  showRemainingQuota: true,
  userClaimedUnits: 0,
  userRemainingQuota: 10,
  ...overrides,
});

const exactUser = {
  now: new Date("2026-06-01T00:00:00Z"),
  userId: 7,
  eligibilityMode: "EXACT" as const,
};

describe("pure promotion selection", () => {
  it("falls back the whole line to the next automatic promotion", () => {
    const result = selectProductPromotion(
      [flash({ remainingQuota: 2 }), automatic()],
      { productId: 1, quantity: 3 },
      exactUser,
    );

    expect(result.winner).toMatchObject({ kind: "AUTOMATIC" });
    expect(result.fallback).toMatchObject({
      reason: "GLOBAL_QUOTA",
      requestedQuantity: 3,
      availableQuantity: 2,
      appliedPromotionKind: "AUTOMATIC",
    });
  });

  it("reports the highest-ranked skipped flash sale when both limits are short", () => {
    const highFlashId = 20;
    const result = selectProductPromotion(
      [
        flash({ id: highFlashId, remainingQuota: 2, userRemainingQuota: 1 }),
        flash({ id: 21, priority: 1, remainingQuota: 0, userRemainingQuota: 0 }),
      ],
      { productId: 1, quantity: 3 },
      exactUser,
    );

    expect(result.winner).toBeNull();
    expect(result.fallback).toMatchObject({
      promotionId: highFlashId,
      reason: "GLOBAL_AND_USER_QUOTA",
      availableQuantity: 1,
    });
  });

  it("lets a lower-ranked Flash Sale win when it has enough quota", () => {
    const result = selectProductPromotion(
      [flash({ remainingQuota: 0 }), flash({ id: 21, priority: 1, remainingQuota: 3 })],
      { productId: 1, quantity: 3 },
      exactUser,
    );

    expect(result.winner).toMatchObject({ id: 21, kind: "FLASH_SALE" });
    expect(result.fallback).toBeNull();
  });

  it("does not report a fallback when an automatic promotion wins first", () => {
    const result = selectProductPromotion(
      [automatic({ priority: 4 }), flash({ priority: 1, remainingQuota: 0 })],
      { productId: 1, quantity: 3 },
      exactUser,
    );

    expect(result).toMatchObject({ eligibility: "EXACT", fallback: null });
    expect(result.winner).toMatchObject({ kind: "AUTOMATIC" });
  });

  it("marks an anonymous Flash Sale selection as potential", () => {
    const result = selectProductPromotion(
      [flash({ remainingQuota: 3 })],
      { productId: 1, quantity: 3 },
      { now: exactUser.now, eligibilityMode: "POTENTIAL" },
    );

    expect(result).toMatchObject({ eligibility: "POTENTIAL", winner: { kind: "FLASH_SALE" } });
  });

  it("does not expose internal quota counters in the public fallback", () => {
    const fallback = toPublicPromotionFallback({
      promotionId: 20,
      reason: "GLOBAL_AND_USER_QUOTA",
      requestedQuantity: 3,
      globalRemaining: 2,
      userRemaining: 1,
      availableQuantity: 1,
      appliedPromotionKind: "AUTOMATIC",
    });

    expect(fallback).toEqual({
      skippedKind: "FLASH_SALE",
      promotionId: 20,
      reason: "GLOBAL_AND_USER_QUOTA",
      requestedQuantity: 3,
      availableQuantity: 1,
      appliedPromotionKind: "AUTOMATIC",
    });
  });

  it("caps fixed discounts at the list price and keeps candidate order irrelevant", () => {
    const a = automatic({ id: 1, discountKind: "FIXED", discountValue: 2_000 });
    const b = automatic({ id: 2, discountKind: "FIXED", discountValue: 500 });
    expect(comparePromotionCandidates(a, b, 1_000)).toBeLessThan(0);
    expect(
      selectProductPromotion([b, a], { productId: 1, quantity: 1 }, exactUser).winner?.id,
    ).toBe(1);
  });
});
