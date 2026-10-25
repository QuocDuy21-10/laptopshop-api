import { sha256Canonical } from "lib/idempotency";
import type {
  CheckoutRequestHashInput,
  PricingFingerprintInput,
} from "modules/promotions/promotions.types";

const normalized = (value: string) => value.trim();

export const createPricingFingerprint = (input: PricingFingerprintInput) =>
  sha256Canonical([
    [...input.lines]
      .sort((a, b) => a.productId - b.productId)
      .map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        listPrice: line.listPrice,
        promotionId: line.promotion?.id ?? null,
        promotionKind: line.promotion?.kind ?? null,
        pricingVersion: line.promotion?.pricingVersion ?? null,
        discountKind: line.promotion?.discountKind ?? null,
        discountValue: line.promotion?.discountValue ?? null,
        priority: line.promotion?.priority ?? null,
        stackableWithCoupon: line.promotion?.stackableWithCoupon ?? null,
        maxUnitsPerUser:
          line.promotion?.kind === "FLASH_SALE" ? line.promotion.maxUnitsPerUser : null,
      })),
    input.coupon
      ? {
          ...input.coupon,
          targetProductIds: [...input.coupon.targetProductIds].sort((a, b) => a - b),
        }
      : null,
    {
      subtotalPrice: input.totals.subtotalPrice,
      productDiscountAmount: input.totals.productDiscountAmount,
      couponEligibleSubtotal: input.totals.couponEligibleSubtotal,
      couponDiscountAmount: input.totals.couponDiscountAmount,
      totalPrice: input.totals.totalPrice,
    },
  ]);

export const createCheckoutRequestHash = (input: CheckoutRequestHashInput) =>
  sha256Canonical([
    {
      receiverName: normalized(input.receiverName),
      receiverAddress: normalized(input.receiverAddress),
      receiverPhone: normalized(input.receiverPhone),
      paymentMethod: normalized(input.paymentMethod),
      couponCode: input.couponCode ? normalized(input.couponCode).toUpperCase() : null,
      pricingFingerprint: input.pricingFingerprint,
    },
  ]);
