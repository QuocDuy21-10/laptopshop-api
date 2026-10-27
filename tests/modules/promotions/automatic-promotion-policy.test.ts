import { describe, expect, it } from "@jest/globals";
import {
  automaticDiscountPerUnit,
  resolveAutomaticPromotionAt,
  type AutomaticPromotionCandidate,
} from "modules/promotions/automatic-promotion-policy";

const candidate = (
  overrides: Partial<AutomaticPromotionCandidate> = {},
): AutomaticPromotionCandidate => ({
  id: 1,
  name: "Automatic",
  discountKind: "FIXED",
  discountValue: 1_000,
  priority: 1,
  stackableWithCoupon: false,
  pricingVersion: 1,
  startsAt: new Date("2026-10-27T00:00:00.000Z"),
  endsAt: new Date("2026-10-28T00:00:00.000Z"),
  ...overrides,
});

describe("canonical Automatic Promotion policy", () => {
  it("selects only startsAt inclusive and endsAt exclusive candidates", () => {
    const promotion = candidate();
    expect(resolveAutomaticPromotionAt([promotion], 10_000, promotion.startsAt)?.id).toBe(1);
    expect(resolveAutomaticPromotionAt([promotion], 10_000, promotion.endsAt)).toBeNull();
  });

  it("orders by priority then unit discount then lowest id", () => {
    const winner = resolveAutomaticPromotionAt(
      [
        candidate({ id: 2, priority: 1, discountValue: 3_000 }),
        candidate({ id: 1, priority: 1, discountValue: 3_000 }),
        candidate({ id: 3, priority: 2, discountValue: 500 }),
      ],
      10_000,
      new Date("2026-10-27T12:00:00.000Z"),
    );
    expect(winner?.id).toBe(3);
  });

  it("caps fixed and percent discounts at list price", () => {
    expect(automaticDiscountPerUnit({ discountKind: "FIXED", discountValue: 12_000 }, 10_000)).toBe(
      10_000,
    );
    expect(automaticDiscountPerUnit({ discountKind: "PERCENT", discountValue: 150 }, 10_000)).toBe(
      10_000,
    );
  });
});
