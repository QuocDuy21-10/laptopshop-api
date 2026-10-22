import type { PromotionState } from "@prisma/client";
import { toActor } from "modules/orders/orders.mapper";
import type { PromotionRow, RedemptionRow } from "modules/promotions/promotions.repository";

export const effectivePromotionState = (
  state: PromotionState,
  startsAt: Date,
  endsAt: Date,
  now = new Date(),
) => {
  if (state !== "ACTIVE") return state;
  if (now < startsAt) return "SCHEDULED" as const;
  if (now >= endsAt) return "EXPIRED" as const;
  return "RUNNING" as const;
};

const lockedFields = (promotion: PromotionRow) =>
  promotion.activatedAt
    ? [
        "kind",
        "code",
        "scope",
        "discountKind",
        "discountValue",
        "startsAt",
        "targets",
        "minOrderValue",
        "maxDiscount",
        "maxUsesPerUser",
        "priority",
        "stackableWithCoupon",
        "maxUnitsPerUser",
      ]
    : [];

export const toPromotionSummaryDto = (promotion: PromotionRow, now = new Date()) => ({
  id: promotion.id,
  kind: promotion.kind,
  state: promotion.state,
  effectiveState: effectivePromotionState(
    promotion.state,
    promotion.startsAt,
    promotion.endsAt,
    now,
  ),
  name: promotion.name,
  discountKind: promotion.discountKind,
  discountValue: promotion.discountValue,
  startsAt: promotion.startsAt,
  endsAt: promotion.endsAt,
  coupon: promotion.couponPolicy
    ? {
        code: promotion.couponPolicy.code,
        scope: promotion.couponPolicy.scope,
        maxUses: promotion.couponPolicy.maxUses,
        usedCount: promotion.couponPolicy.usedCount,
        isPublic: promotion.couponPolicy.isPublic,
      }
    : null,
  priority: promotion.automaticPolicy?.priority ?? promotion.flashSalePolicy?.priority ?? null,
  redemptionCount: promotion._count.redemptions,
});
export type AdminPromotionSummaryDto = ReturnType<typeof toPromotionSummaryDto>;

export const toPromotionDetailDto = (promotion: PromotionRow, now = new Date()) => ({
  ...toPromotionSummaryDto(promotion, now),
  description: promotion.description,
  activatedAt: promotion.activatedAt,
  pricingVersion: promotion.pricingVersion,
  createdAt: promotion.createdAt,
  updatedAt: promotion.updatedAt,
  createdBy: toActor(promotion.createdBy),
  updatedBy: toActor(promotion.updatedBy),
  lockedFields: lockedFields(promotion),
  coupon: promotion.couponPolicy
    ? {
        code: promotion.couponPolicy.code,
        scope: promotion.couponPolicy.scope,
        minOrderValue: promotion.couponPolicy.minOrderValue,
        maxDiscount: promotion.couponPolicy.maxDiscount,
        maxUses: promotion.couponPolicy.maxUses,
        usedCount: promotion.couponPolicy.usedCount,
        maxUsesPerUser: promotion.couponPolicy.maxUsesPerUser,
        isPublic: promotion.couponPolicy.isPublic,
        targetProductIds: promotion.products.map((target) => target.productId),
      }
    : null,
  automatic: promotion.automaticPolicy
    ? {
        priority: promotion.automaticPolicy.priority,
        stackableWithCoupon: promotion.automaticPolicy.stackableWithCoupon,
        targetProductIds: promotion.products.map((target) => target.productId),
      }
    : null,
  flashSale: promotion.flashSalePolicy
    ? {
        priority: promotion.flashSalePolicy.priority,
        stackableWithCoupon: promotion.flashSalePolicy.stackableWithCoupon,
        showRemainingQuota: promotion.flashSalePolicy.showRemainingQuota,
        quotas: promotion.flashSalePolicy.quotas.map((quota) => ({
          productId: quota.productId,
          totalQuota: quota.totalQuota,
          claimedUnits: quota.claimedUnits,
          remainingQuota: Math.max(0, quota.totalQuota - quota.claimedUnits),
          maxUnitsPerUser: quota.maxUnitsPerUser,
        })),
      }
    : null,
  products: (promotion.flashSalePolicy?.quotas ?? promotion.products).map((target) => ({
    id: target.product.id,
    name: target.product.name,
    image: target.product.image ? `/images/product/${target.product.image}` : null,
  })),
});
export type AdminPromotionDetailDto = ReturnType<typeof toPromotionDetailDto>;

export const toRedemptionDto = (redemption: RedemptionRow) => ({
  id: redemption.id,
  promotionId: redemption.promotionId,
  user: redemption.user,
  orderId: redemption.orderId,
  orderStatus: redemption.order.status,
  orderTotal: redemption.order.totalPrice,
  discountAmount: redemption.discountAmount,
  status: redemption.status,
  createdAt: redemption.createdAt,
  reversedAt: redemption.reversedAt,
  reverseReason: redemption.reverseReason,
});
export type PromotionRedemptionDto = ReturnType<typeof toRedemptionDto>;
