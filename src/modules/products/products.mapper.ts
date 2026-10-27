import { Product } from "@prisma/client";
import {
  emptyProductReviewSummary,
  type ProductReviewSummary,
} from "modules/products/products.review-stats.repository";
import type {
  ProductPromotionResolution,
  ResolvedAutomaticPromotion,
} from "modules/promotions/promotion-resolver";

export const productImage = (file: string | null) => (file ? `/images/product/${file}` : null);

export const toProductDto = (p: Product) => ({ ...p, image: productImage(p.image) });

export type ProductDto = ReturnType<typeof toProductDto>;

export const toPricedProductDto = (
  product: Product,
  resolution: ProductPromotionResolution | null,
) => ({
  ...toProductDto(product),
  salePrice: resolution?.winner ? product.price - resolution.winner.unitDiscount : product.price,
  productDiscountAmount: resolution?.winner?.unitDiscount ?? 0,
  promotion: resolution?.winner
    ? {
        id: resolution.winner.id,
        name: resolution.winner.name,
        endsAt: resolution.winner.endsAt,
        kind: resolution.winner.kind,
        eligibility: resolution.winner.kind === "AUTOMATIC" ? "EXACT" : resolution.eligibility,
      }
    : null,
});
export type PricedProductDto = ReturnType<typeof toPricedProductDto>;

export const withProductPricingDto = (
  product: ProductDto,
  promotion: ResolvedAutomaticPromotion | null,
) => ({
  ...product,
  salePrice: promotion ? product.price - promotion.unitDiscount : product.price,
  productDiscountAmount: promotion?.unitDiscount ?? 0,
  promotion: promotion
    ? {
        id: promotion.id,
        name: promotion.name,
        endsAt: promotion.endsAt,
        kind: "AUTOMATIC" as const,
        eligibility: "EXACT" as const,
      }
    : null,
});

export const toCatalogProductDto = (
  product: Product,
  summary?: ProductReviewSummary,
  resolution: ProductPromotionResolution | null = null,
  effectiveCatalogPrice = product.price,
) => ({
  ...toPricedProductDto(product, resolution),
  effectiveCatalogPrice,
  reviewSummary: summary ?? emptyProductReviewSummary,
});

export type CatalogProductDto = ReturnType<typeof toCatalogProductDto>;
