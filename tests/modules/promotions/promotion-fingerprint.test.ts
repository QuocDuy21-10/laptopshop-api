import {
  createCheckoutRequestHash,
  createPricingFingerprint,
} from "modules/promotions/promotion-fingerprint";
import type {
  CheckoutRequestHashInput,
  PricingFingerprintInput,
  ResolvedAutomaticPromotion,
  ResolvedFlashSale,
} from "modules/promotions/promotions.types";

const automatic = (
  overrides: Partial<ResolvedAutomaticPromotion> = {},
): ResolvedAutomaticPromotion => ({
  id: 8,
  name: "Automatic",
  kind: "AUTOMATIC",
  discountKind: "FIXED",
  discountValue: 2,
  priority: 1,
  stackableWithCoupon: true,
  pricingVersion: 3,
  startsAt: new Date("2026-10-01T00:00:00Z"),
  endsAt: new Date("2026-11-01T00:00:00Z"),
  unitDiscount: 2,
  ...overrides,
});

const flash = (overrides: Partial<ResolvedFlashSale> = {}): ResolvedFlashSale => ({
  ...automatic(),
  kind: "FLASH_SALE",
  totalQuota: 10,
  claimedUnits: 2,
  remainingQuota: 8,
  maxUnitsPerUser: 2,
  showRemainingQuota: true,
  userClaimedUnits: 1,
  userRemainingQuota: 1,
  ...overrides,
});

const fingerprintInput = (reverse = false): PricingFingerprintInput => ({
  lines: reverse
    ? [
        { productId: 2, quantity: 1, listPrice: 20, promotion: automatic() },
        {
          productId: 1,
          quantity: 2,
          listPrice: 10,
          promotion: null,
        },
      ]
    : [
        {
          productId: 1,
          quantity: 2,
          listPrice: 10,
          promotion: null,
        },
        { productId: 2, quantity: 1, listPrice: 20, promotion: automatic() },
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
          line.productId === 2 ? { ...line, promotion: automatic({ pricingVersion: 4 }) } : line,
        ),
      }),
    );
  });

  it("keeps a Flash Sale fingerprint stable when only mutable counters change", () => {
    const base = {
      ...fingerprintInput(),
      lines: fingerprintInput().lines.map((line) => ({
        ...line,
        promotion: flash({ discountKind: "PERCENT", discountValue: 20, priority: 3 }),
      })),
    };
    expect(createPricingFingerprint(base)).toBe(
      createPricingFingerprint({
        ...base,
        lines: base.lines.map((line) => ({
          ...line,
          promotion: flash({
            discountKind: "PERCENT",
            discountValue: 20,
            priority: 3,
            totalQuota: 100,
            claimedUnits: 99,
            remainingQuota: 1,
            showRemainingQuota: false,
          }),
        })),
      }),
    );
    expect(createPricingFingerprint(base)).not.toBe(
      createPricingFingerprint({
        ...base,
        lines: base.lines.map((line) => ({
          ...line,
          promotion: flash({ discountKind: "PERCENT", discountValue: 25, priority: 3 }),
        })),
      }),
    );
  });

  it("changes when quota fallback switches the resolved winner from Flash Sale to Automatic", () => {
    const base = {
      ...fingerprintInput(),
      lines: fingerprintInput().lines.map((line) => ({ ...line, promotion: flash() })),
    };
    expect(createPricingFingerprint(base)).not.toBe(
      createPricingFingerprint({
        ...base,
        lines: base.lines.map((line) => ({ ...line, promotion: automatic() })),
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
