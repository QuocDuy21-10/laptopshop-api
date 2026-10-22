import { Prisma } from "@prisma/client";
import { toPricedProductDto, type PricedProductDto } from "modules/products/products.mapper";
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
) => ({
  id: row.id,
  productId: row.productId,
  product: toPricedProductDto(row.product, promotion),
  alertMode: row.alertMode,
  targetPrice: row.targetPrice,
  referencePrice: row.referencePrice,
  lastAlertMode: row.lastAlertMode,
  lastAlertedPrice: row.lastAlertedPrice,
  lastAlertedAt: row.lastAlertedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export type WishlistItemDto = ReturnType<typeof toWishlistItemDto>;
export type WishlistProductDto = PricedProductDto;
