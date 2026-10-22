import {
  createCheckoutRequestHash,
  createPricingFingerprint,
} from "modules/promotions/promotion-fingerprint";
import type {
  CheckoutRequestHashInput,
  PricingFingerprintInput,
} from "modules/promotions/promotions.types";

const fingerprintInput = (reverse = false): PricingFingerprintInput => ({
  lines: reverse
    ? [
        { productId: 2, quantity: 1, listPrice: 20, automaticPromotionId: 8, pricingVersion: 3 },
        {
          productId: 1,
          quantity: 2,
          listPrice: 10,
          automaticPromotionId: null,
          pricingVersion: null,
        },
      ]
    : [
        {
          productId: 1,
          quantity: 2,
          listPrice: 10,
          automaticPromotionId: null,
          pricingVersion: null,
        },
        { productId: 2, quantity: 1, listPrice: 20, automaticPromotionId: 8, pricingVersion: 3 },
      ],
  coupon: {
    id: 9,
    pricingVersion: 4,
    scope: "PRODUCT",
    targetProductIds: reverse ? [2, 1] : [1, 2],
  },
  totals: {
    subtotalPrice: 40,
    productDiscountAmount: 2,
    couponEligibleSubtotal: 38,
    couponDiscountAmount: 3,
    totalPrice: 35,
  },
});

describe("promotion fingerprints", () => {
  it("is stable when lines and target IDs arrive in a different order", () => {
    expect(createPricingFingerprint(fingerprintInput())).toBe(
      createPricingFingerprint(fingerprintInput(true)),
    );
  });

  it("changes when pricing version or totals change", () => {
    const base = fingerprintInput();
    expect(createPricingFingerprint(base)).not.toBe(
      createPricingFingerprint({ ...base, totals: { ...base.totals, totalPrice: 34 } }),
    );
    expect(createPricingFingerprint(base)).not.toBe(
      createPricingFingerprint({
        ...base,
        lines: base.lines.map((line) =>
          line.productId === 2 ? { ...line, pricingVersion: 4 } : line,
        ),
      }),
    );
  });

  it("ignores mutable Flash Sale counters and visibility but includes pricing config", () => {
    const base = {
      ...fingerprintInput(),
      lines: fingerprintInput().lines.map((line) => ({
        ...line,
        promotionKind: "FLASH_SALE" as const,
        discountKind: "PERCENT" as const,
        discountValue: 20,
        priority: 3,
        stackableWithCoupon: true,
        maxUnitsPerUser: 2,
        totalQuota: 10,
        claimedUnits: 2,
        remainingQuota: 8,
        showRemainingQuota: true,
      })),
    };
    expect(createPricingFingerprint(base)).toBe(
      createPricingFingerprint({
        ...base,
        lines: base.lines.map((line) => ({
          ...line,
          totalQuota: 100,
          claimedUnits: 99,
          remainingQuota: 1,
          showRemainingQuota: false,
        })),
      }),
    );
    expect(createPricingFingerprint(base)).not.toBe(
      createPricingFingerprint({
        ...base,
        lines: base.lines.map((line) => ({ ...line, discountValue: 25 })),
      }),
    );
    expect(createPricingFingerprint(base)).not.toBe(
      createPricingFingerprint({
        ...base,
        lines: base.lines.map((line) => ({ ...line, maxUnitsPerUser: 1 })),
      }),
    );
  });

  it("normalizes checkout receiver and coupon fields before hashing", () => {
    const base: CheckoutRequestHashInput = {
      receiverName: " Nguyễn A ",
      receiverAddress: " 1 Lê Lợi ",
      receiverPhone: " 0900000000 ",
      paymentMethod: "COD",
      couponCode: " welcome10 ",
      pricingFingerprint: "abc",
    };
    expect(createCheckoutRequestHash(base)).toBe(
      createCheckoutRequestHash({
        ...base,
        receiverName: "Nguyễn A",
        receiverAddress: "1 Lê Lợi",
        receiverPhone: "0900000000",
        couponCode: "WELCOME10",
      }),
    );
  });
});
