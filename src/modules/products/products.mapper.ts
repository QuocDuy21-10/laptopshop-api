import { Product } from "@prisma/client";
import {
  emptyProductReviewSummary,
  type ProductReviewSummary,
} from "modules/products/products.review-stats.repository";

export const productImage = (file: string | null) => (file ? `/images/product/${file}` : null);

export const toProductDto = (p: Product) => ({ ...p, image: productImage(p.image) });

export type ProductDto = ReturnType<typeof toProductDto>;

export const toCatalogProductDto = (product: Product, summary?: ProductReviewSummary) => ({
  ...toProductDto(product),
  reviewSummary: summary ?? emptyProductReviewSummary,
});

export type CatalogProductDto = ReturnType<typeof toCatalogProductDto>;
