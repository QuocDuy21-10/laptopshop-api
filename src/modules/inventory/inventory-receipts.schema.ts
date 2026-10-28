import { z } from "zod";
import { pageQuery } from "lib/http";
import { toShopDay } from "lib/shop-time";

export const RECEIPT_STATUS = {
  DRAFT: "DRAFT",
  POSTED: "POSTED",
} as const;
export type ReceiptStatus = (typeof RECEIPT_STATUS)[keyof typeof RECEIPT_STATUS];
export const RECEIPT_STATUSES = Object.values(RECEIPT_STATUS) as [
  ReceiptStatus,
  ...ReceiptStatus[],
];

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(max).optional(),
  );

const receiptItem = z.object({
  productId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().min(1).max(10_000),
  unitCost: z.coerce.number().int().min(0).max(2_000_000_000).optional(),
});

const uniqueProducts = (items: Array<{ productId: number }>) =>
  new Set(items.map(({ productId }) => productId)).size === items.length;

export const createReceiptBody = z
  .object({
    supplierName: optionalText(255),
    note: optionalText(500),
    items: z.array(receiptItem).min(1).max(100).refine(uniqueProducts, "Duplicate products"),
  })
  .strict();
export type CreateReceiptBody = z.infer<typeof createReceiptBody>;

const receiptVersion = z.number().int().min(0);

export const updateReceiptBody = createReceiptBody
  .partial()
  .extend({ version: receiptVersion })
  .refine(
    (body) => Object.keys(body).some((key) => key !== "version"),
    "At least one field is required",
  );
export type UpdateReceiptBody = z.infer<typeof updateReceiptBody>;

export const postReceiptBody = z.object({ version: receiptVersion }).strict();
export type PostReceiptBody = z.infer<typeof postReceiptBody>;

export const receiptIdParams = z.object({ id: z.string().uuid() });
export type ReceiptIdParams = z.infer<typeof receiptIdParams>;

export const listReceiptsQuery = pageQuery.extend({
  status: z.enum(RECEIPT_STATUSES).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});
export type ListReceiptsQuery = z.infer<typeof listReceiptsQuery>;

export const generateReceiptCode = (now: Date, randomId: string) =>
  `PN-${toShopDay(now).replace(/-/g, "")}-${randomId.slice(0, 8).toUpperCase()}`;
