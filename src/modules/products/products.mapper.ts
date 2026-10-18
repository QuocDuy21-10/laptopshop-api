import { Product } from "@prisma/client";

export const productImage = (file: string | null) => (file ? `/images/product/${file}` : null);

export const toProductDto = (p: Product) => ({ ...p, image: productImage(p.image) });

export type ProductDto = ReturnType<typeof toProductDto>;
