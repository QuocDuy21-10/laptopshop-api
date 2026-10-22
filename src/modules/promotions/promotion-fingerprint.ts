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
        promotionId: line.promotionId ?? line.automaticPromotionId,
        promotionKind:
          line.promotionKind ?? (line.automaticPromotionId === null ? null : "AUTOMATIC"),
        pricingVersion: line.pricingVersion,
        discountKind: line.discountKind ?? null,
        discountValue: line.discountValue ?? null,
        priority: line.priority ?? null,
        stackableWithCoupon: line.stackableWithCoupon ?? null,
        maxUnitsPerUser: line.maxUnitsPerUser ?? null,
      })),
    input.coupon
      ? {
          ...input.coupon,
          targetProductIds: [...input.coupon.targetProductIds].sort((a, b) => a - b),
        }
      : null,
    input.totals,
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
