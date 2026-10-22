import {
  calculatePromotionPricing,
  selectAutomaticPromotion,
} from "modules/promotions/promotion-pricing";
import type {
  AutomaticPromotionInput,
  CouponInput,
  PromotionPricingInput,
} from "modules/promotions/promotions.types";

const automatic = (overrides: Partial<AutomaticPromotionInput> = {}): AutomaticPromotionInput => ({
  id: 1,
  name: "Sale",
  discountKind: "PERCENT",
  discountValue: 10,
  priority: 1,
  stackableWithCoupon: true,
  pricingVersion: 1,
  ...overrides,
});

const coupon = (overrides: Partial<CouponInput> = {}): CouponInput => ({
  id: 10,
  code: "WELCOME10",
  name: "Welcome",
  scope: "ORDER",
  discountKind: "PERCENT",
  discountValue: 10,
  minOrderValue: 0,
  maxDiscount: null,
  pricingVersion: 1,
  targetProductIds: [],
  ...overrides,
});

describe("promotion pricing", () => {
  it("selects the highest priority automatic promotion", () => {
    const winner = selectAutomaticPromotion(
      [
        automatic({ id: 1, priority: 1, discountValue: 50 }),
        automatic({ id: 2, priority: 2, discountValue: 10 }),
      ],
      1_000,
    );

    expect(winner?.id).toBe(2);
  });

  it("selects the larger discount when priorities tie", () => {
    const winner = selectAutomaticPromotion(
      [
        automatic({ id: 1, priority: 2, discountKind: "FIXED", discountValue: 50 }),
        automatic({ id: 2, priority: 2, discountKind: "FIXED", discountValue: 100 }),
      ],
      1_000,
    );

    expect(winner?.id).toBe(2);
  });

  it("rounds automatic percentage discounts on one unit before multiplying quantity", () => {
    const result = calculatePromotionPricing({
      lines: [{ productId: 1, quantity: 3, listPrice: 99, automaticCandidates: [automatic()] }],
    });

    expect(result.lines[0]).toMatchObject({
      productId: 1,
      lineSubtotal: 297,
      productDiscountAmount: 27,
      postProductLineTotal: 270,
      netLineTotal: 270,
    });
  });

  it("applies a fixed automatic discount per unit and caps each unit at zero", () => {
    const result = calculatePromotionPricing({
      lines: [
        {
          productId: 1,
          quantity: 3,
          listPrice: 250,
          automaticCandidates: [automatic({ discountKind: "FIXED", discountValue: 100 })],
        },
      ],
    });

    expect(result.lines[0]).toMatchObject({ productDiscountAmount: 300, netLineTotal: 450 });
  });

  it("applies a fixed coupon once per order", () => {
    const result = calculatePromotionPricing({
      lines: [{ productId: 1, quantity: 3, listPrice: 100 }],
      coupon: coupon({ discountKind: "FIXED", discountValue: 150 }),
    });

    expect(result).toMatchObject({
      subtotalPrice: 300,
      couponEligibleSubtotal: 300,
      couponDiscountAmount: 150,
      totalPrice: 150,
    });
  });

  it("caps a percentage coupon at maxDiscount", () => {
    const result = calculatePromotionPricing({
      lines: [{ productId: 1, quantity: 1, listPrice: 1_000 }],
      coupon: coupon({ discountValue: 20, maxDiscount: 100 }),
    });

    expect(result.couponDiscountAmount).toBe(100);
  });

  it("allocates integer coupon remainders by productId and excludes zero-value lines", () => {
    const input: PromotionPricingInput = {
      lines: [
        { productId: 3, quantity: 1, listPrice: 10 },
        { productId: 0, quantity: 1, listPrice: 0 },
        { productId: 1, quantity: 1, listPrice: 10 },
        { productId: 2, quantity: 1, listPrice: 10 },
      ],
      coupon: coupon({ discountKind: "FIXED", discountValue: 10 }),
    };
    const result = calculatePromotionPricing(input);

    expect(result.lines.map((line) => [line.productId, line.couponDiscountAmount])).toEqual([
      [0, 0],
      [1, 4],
      [2, 3],
      [3, 3],
    ]);
    expect(result.lines.reduce((sum, line) => sum + line.couponDiscountAmount, 0)).toBe(10);
    expect(result.totalPrice).toBe(20);
  });
});
