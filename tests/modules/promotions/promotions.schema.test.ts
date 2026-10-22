import {
  createPromotionBody,
  transitionPromotionBody,
  updatePromotionBody,
} from "modules/promotions/promotions.schema";

const base = {
  kind: "COUPON" as const,
  name: "Welcome",
  discountKind: "PERCENT" as const,
  discountValue: 10,
  startsAt: "2026-10-01T00:00:00.000Z",
  endsAt: "2026-11-01T00:00:00.000Z",
  coupon: {
    code: " welcome10 ",
    scope: "ORDER" as const,
    minOrderValue: 0,
    maxUsesPerUser: 1,
    isPublic: false,
  },
};

describe("promotion schemas", () => {
  it("normalizes an uppercase coupon code and accepts a valid coupon draft", () => {
    const result = createPromotionBody.parse(base);
    expect(result.coupon?.code).toBe("WELCOME10");
  });

  it("rejects invalid coupon code, percent and fixed values", () => {
    expect(
      createPromotionBody.safeParse({ ...base, coupon: { ...base.coupon, code: "bad code" } })
        .success,
    ).toBe(false);
    expect(createPromotionBody.safeParse({ ...base, discountValue: 101 }).success).toBe(false);
    expect(
      createPromotionBody.safeParse({ ...base, discountKind: "FIXED", discountValue: 0 }).success,
    ).toBe(false);
  });

  it("rejects reversed dates, invalid scope targets and bad usage bounds", () => {
    expect(createPromotionBody.safeParse({ ...base, startsAt: base.endsAt }).success).toBe(false);
    expect(
      createPromotionBody.safeParse({
        ...base,
        coupon: { ...base.coupon, scope: "ORDER", targetProductIds: [1] },
      }).success,
    ).toBe(false);
    expect(
      createPromotionBody.safeParse({ ...base, coupon: { ...base.coupon, maxUses: 0 } }).success,
    ).toBe(false);
  });

  it("accepts automatic product targeting and rejects an empty patch", () => {
    const automatic = createPromotionBody.parse({
      ...base,
      kind: "AUTOMATIC",
      coupon: undefined,
      automatic: { priority: 2, stackableWithCoupon: true, targetProductIds: [1, 2] },
    });
    expect(automatic.automatic?.targetProductIds).toEqual([1, 2]);
    expect(updatePromotionBody.safeParse({}).success).toBe(false);
  });

  it("only accepts known lifecycle actions", () => {
    expect(transitionPromotionBody.safeParse({ action: "ACTIVATE" }).success).toBe(true);
    expect(transitionPromotionBody.safeParse({ action: "DELETE" }).success).toBe(false);
  });
});
