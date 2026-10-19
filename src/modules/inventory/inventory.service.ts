import { Prisma } from "@prisma/client";
import { prisma } from "config/client";
import { AppError, isNotFound, notFound } from "lib/errors";
import { assertExportSize, CsvColumn, toCsv } from "lib/csv";
import { pageArgs, pageMeta } from "lib/http";
import { assertDayRange, createdAtRange, formatShopDateTime } from "lib/shop-time";
import { outOfStock } from "modules/cart/cart.service";
import { MovementRow, movementInclude, toMovementDto } from "modules/inventory/inventory.mapper";
import {
  AdjustmentBody,
  ExportMovementsQuery,
  ListMovementsQuery,
  STOCK_REASON,
  StockReason,
} from "modules/inventory/inventory.schema";
import { toProductDto } from "modules/products/products.mapper";

export type StockMove = {
  productId: number;
  delta: number;
  reason: StockReason;
  orderId?: number;
  actorId?: number;
  note?: string;
  onlyActive?: boolean;
};

const soldChange = ({ reason, delta }: StockMove) =>
  reason === STOCK_REASON.ORDER
    ? { sold: { increment: -delta } }
    : reason === STOCK_REASON.ORDER_CANCEL
      ? { sold: { decrement: delta } }
      : {};

// the only way stock changes: quantity and its ledger row move together in the caller's transaction
export const moveStock = async (tx: Prisma.TransactionClient, m: StockMove) => {
  if (m.delta < 0) {
    const { count } = await tx.product.updateMany({
      where: {
        id: m.productId,
        quantity: { gte: -m.delta },
        ...(m.onlyActive ? { isActive: true } : {}),
      },
      data: { quantity: { decrement: -m.delta }, ...soldChange(m) },
    });
    if (count === 0) throw outOfStock(m.productId);
  } else {
    try {
      await tx.product.update({
        where: { id: m.productId },
        data: { quantity: { increment: m.delta }, ...soldChange(m) },
      });
    } catch (e) {
      if (isNotFound(e)) throw notFound("Product");
      throw e;
    }
  }
  return tx.stockMovement.create({
    data: {
      productId: m.productId,
      delta: m.delta,
      reason: m.reason,
      orderId: m.orderId,
      actorId: m.actorId,
      note: m.note,
    },
  });
};

const invalid = (path: string, message: string) =>
  new AppError("Validation failed", 400, "VALIDATION_ERROR", [{ path, message }]);

// shortcut: no Idempotency-Key, the UI locks the button while sending; add a key + unique (actorId, key) if retries ever double-apply
export const adjustStock = async (actorId: number, body: AdjustmentBody) => {
  if (body.reason === STOCK_REASON.RESTOCK && body.delta < 0) {
    throw invalid("delta", "a restock must add stock");
  }
  if (body.reason === STOCK_REASON.CORRECTION && !body.note) {
    throw invalid("note", "a correction needs a note");
  }
  return prisma.$transaction(async (tx) => {
    const exists = await tx.product.findUnique({
      where: { id: body.productId },
      select: { id: true },
    });
    if (!exists) throw notFound("Product");
    const created = await moveStock(tx, {
      productId: body.productId,
      delta: body.delta,
      reason: body.reason,
      actorId,
      note: body.note || undefined,
    });
    const product = await tx.product.findUniqueOrThrow({ where: { id: body.productId } });
    const movement = await tx.stockMovement.findUniqueOrThrow({
      where: { id: created.id },
      include: movementInclude,
    });
    return { product: toProductDto(product), movement: toMovementDto(movement) };
  });
};

export const movementWhere = (
  q: Omit<ListMovementsQuery, "page" | "pageSize">,
): Prisma.StockMovementWhereInput => {
  assertDayRange(q.from, q.to);
  return {
    ...(q.productId ? { productId: q.productId } : {}),
    ...(q.reason ? { reason: q.reason } : {}),
    ...createdAtRange(q.from, q.to),
  };
};

export const newestFirst: Prisma.StockMovementOrderByWithRelationInput[] = [
  { createdAt: "desc" },
  { id: "desc" },
];

export const listMovements = async (q: ListMovementsQuery) => {
  const where = movementWhere(q);
  const [total, rows] = await Promise.all([
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({
      where,
      include: movementInclude,
      orderBy: newestFirst,
      ...pageArgs(q),
    }),
  ]);
  return { items: rows.map(toMovementDto), meta: pageMeta(q, total) };
};

const MOVEMENT_COLUMNS: CsvColumn<MovementRow>[] = [
  { header: "Thời gian", value: (m) => formatShopDateTime(m.createdAt) },
  { header: "Mã SP", value: (m) => m.productId },
  { header: "Sản phẩm", value: (m) => m.product.name },
  { header: "Thay đổi", value: (m) => m.delta },
  { header: "Lý do", value: (m) => m.reason },
  { header: "Mã đơn", value: (m) => m.orderId },
  {
    header: "Người thao tác",
    value: (m) => (m.actor ? (m.actor.fullName ?? m.actor.username) : null),
  },
  { header: "Ghi chú", value: (m) => m.note },
];

export const exportMovements = async (q: ExportMovementsQuery) => {
  const where = movementWhere(q);
  assertExportSize(await prisma.stockMovement.count({ where }));
  const rows = await prisma.stockMovement.findMany({
    where,
    include: movementInclude,
    orderBy: newestFirst,
  });
  return toCsv(MOVEMENT_COLUMNS, rows);
};
