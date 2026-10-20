import { Prisma } from "@prisma/client";
import { toActor } from "modules/orders/orders.mapper";
import { productImage } from "modules/products/products.mapper";
import { movementInclude, toMovementDto } from "modules/inventory/inventory.mapper";

const actorSelect = { select: { id: true, fullName: true, username: true } } as const;

export const receiptSummaryInclude = {
  createdBy: actorSelect,
  postedBy: actorSelect,
  _count: { select: { items: true } },
} satisfies Prisma.StockReceiptInclude;
export type ReceiptSummaryRow = Prisma.StockReceiptGetPayload<{
  include: typeof receiptSummaryInclude;
}>;

export const receiptDetailInclude = {
  createdBy: actorSelect,
  postedBy: actorSelect,
  items: {
    orderBy: { id: "asc" },
    include: { product: { select: { id: true, name: true, image: true, isActive: true } } },
  },
  movements: { include: movementInclude, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.StockReceiptInclude;
export type ReceiptDetailRow = Prisma.StockReceiptGetPayload<{
  include: typeof receiptDetailInclude;
}>;

export const toReceiptSummaryDto = (receipt: ReceiptSummaryRow) => ({
  id: receipt.id,
  code: receipt.code,
  supplierName: receipt.supplierName,
  status: receipt.status,
  note: receipt.note,
  createdAt: receipt.createdAt,
  postedAt: receipt.postedAt,
  createdBy: toActor(receipt.createdBy),
  postedBy: toActor(receipt.postedBy),
  itemCount: receipt._count.items,
});
export type ReceiptSummaryDto = ReturnType<typeof toReceiptSummaryDto>;

export const toReceiptDetailDto = (receipt: ReceiptDetailRow) => ({
  id: receipt.id,
  code: receipt.code,
  supplierName: receipt.supplierName,
  status: receipt.status,
  note: receipt.note,
  createdAt: receipt.createdAt,
  postedAt: receipt.postedAt,
  createdBy: toActor(receipt.createdBy),
  postedBy: toActor(receipt.postedBy),
  items: receipt.items.map((item) => ({
    id: item.id,
    productId: item.productId,
    productName: item.product.name,
    image: productImage(item.product.image),
    isActive: item.product.isActive,
    quantity: item.quantity,
    unitCost: item.unitCost,
  })),
  movements: receipt.movements.map(toMovementDto),
});
export type ReceiptDetailDto = ReturnType<typeof toReceiptDetailDto>;
