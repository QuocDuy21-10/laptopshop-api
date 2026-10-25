import { Prisma } from "@prisma/client";
import {
  toProductDto,
  withProductPricingDto,
  type PricedProductDto,
} from "modules/products/products.mapper";
import type { PriceSnapshot } from "modules/pricing/alert-price-resolver";
import type { ResolvedAutomaticPromotion } from "modules/promotions/promotion-resolver";

export const wishlistItemInclude = {
  product: true,
} satisfies Prisma.WishlistItemInclude;

export type WishlistItemRow = Prisma.WishlistItemGetPayload<{
  include: typeof wishlistItemInclude;
}>;

export const toWishlistItemDto = (
  row: WishlistItemRow,
  promotion: ResolvedAutomaticPromotion | null = null,
  snapshot: PriceSnapshot | null = null,
) => ({
  id: row.id,
  productId: row.productId,
  product: snapshot
    ? {
        ...toProductDto(row.product),
        salePrice: snapshot.effectivePrice,
        productDiscountAmount: row.product.price - snapshot.effectivePrice,
        promotion: promotion
          ? {
              id: promotion.id,
              name: promotion.name,
              endsAt: promotion.endsAt,
              kind: "AUTOMATIC" as const,
              eligibility: "EXACT" as const,
            }
          : null,
      }
    : withProductPricingDto(toProductDto(row.product), promotion),
  alertMode: row.alertMode,
  targetPrice: row.targetPrice,
  referencePrice: row.referencePrice,
  includeFlashSale: row.includeFlashSale,
  alertVersion: row.alertVersion,
  priceSnapshot: snapshot ?? {
    productId: row.productId,
    listPrice: row.product.price,
    stablePrice: row.product.price,
    effectivePrice: row.product.price,
    source: "LIST_PRICE" as const,
    promotionId: null,
    pricingVersion: null,
    validUntil: null,
    purchasable: row.product.isActive && row.product.quantity > 0,
  },
  lastAlertMode: row.lastAlertMode,
  lastAlertedPrice: row.lastAlertedPrice,
  lastAlertedAt: row.lastAlertedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export type WishlistItemDto = ReturnType<typeof toWishlistItemDto>;
export type WishlistProductDto = PricedProductDto;
