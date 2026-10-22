import { Product } from "@prisma/client";
import {
  emptyProductReviewSummary,
  type ProductReviewSummary,
} from "modules/products/products.review-stats.repository";
import type { ResolvedAutomaticPromotion } from "modules/promotions/promotion-resolver";

export const productImage = (file: string | null) => (file ? `/images/product/${file}` : null);

export const toProductDto = (p: Product) => ({ ...p, image: productImage(p.image) });

export type ProductDto = ReturnType<typeof toProductDto>;

export const toPricedProductDto = (
  product: Product,
  promotion: ResolvedAutomaticPromotion | null,
) => ({
  ...toProductDto(product),
  salePrice: promotion ? product.price - promotion.unitDiscount : product.price,
  productDiscountAmount: promotion?.unitDiscount ?? 0,
  promotion: promotion
    ? { id: promotion.id, name: promotion.name, endsAt: promotion.endsAt }
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
    ? { id: promotion.id, name: promotion.name, endsAt: promotion.endsAt }
    : null,
});

export const toCatalogProductDto = (
  product: Product,
  summary?: ProductReviewSummary,
  promotion: ResolvedAutomaticPromotion | null = null,
) => ({
  ...toPricedProductDto(product, promotion),
  reviewSummary: summary ?? emptyProductReviewSummary,
});

export type CatalogProductDto = ReturnType<typeof toCatalogProductDto>;
