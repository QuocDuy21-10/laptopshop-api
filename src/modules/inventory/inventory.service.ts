import { Prisma } from "@prisma/client";
import { prisma } from "config/client";
import { AppError, isNotFound, notFound } from "lib/errors";
import { assertExportSize, CsvColumn, toCsv } from "lib/csv";
import { pageArgs, pageMeta } from "lib/http";
import { sha256Canonical } from "lib/idempotency";
import { logger } from "lib/logger";
import { assertDayRange, createdAtRange, formatShopDateTime } from "lib/shop-time";
import { outOfStock, productUnavailable } from "modules/cart/cart.service";
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
  receiptId?: string;
  actorId?: number;
  note?: string;
  idempotencyKey?: string;
  requestHash?: string;
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
  let balanceAfter: number;
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
    const product = await tx.product.findUniqueOrThrow({
      where: { id: m.productId },
      select: { quantity: true },
    });
    balanceAfter = product.quantity;
  } else if (m.onlyActive) {
    const { count } = await tx.product.updateMany({
      where: { id: m.productId, isActive: true },
      data: { quantity: { increment: m.delta }, ...soldChange(m) },
    });
    if (count === 0) {
      const exists = await tx.product.findUnique({
        where: { id: m.productId },
        select: { id: true },
      });
      throw exists ? productUnavailable(m.productId) : notFound("Product");
    }
    const product = await tx.product.findUniqueOrThrow({
      where: { id: m.productId },
      select: { quantity: true },
    });
    balanceAfter = product.quantity;
  } else {
    try {
      const product = await tx.product.update({
        where: { id: m.productId },
        data: { quantity: { increment: m.delta }, ...soldChange(m) },
      });
      balanceAfter = product.quantity;
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
      balanceBefore: balanceAfter - m.delta,
      balanceAfter,
      ...(m.receiptId ? { receiptId: m.receiptId } : {}),
      ...(m.idempotencyKey ? { idempotencyKey: m.idempotencyKey } : {}),
      ...(m.requestHash ? { requestHash: m.requestHash } : {}),
    },
  });
};

const invalid = (path: string, message: string) =>
  new AppError("Validation failed", 400, "VALIDATION_ERROR", [{ path, message }]);

export type AdjustStockResult = {
  product: ReturnType<typeof toProductDto>;
  movement: ReturnType<typeof toMovementDto>;
  created: boolean;
};

const idempotencyConflict = () =>
  new AppError(
    "Idempotency key was reused with a different payload",
    409,
    "IDEMPOTENCY_KEY_REUSED",
  );

export const adjustStock = async (
  actorId: number,
  idempotencyKey: string | undefined,
  body: AdjustmentBody,
): Promise<AdjustStockResult> => {
  if (body.reason === STOCK_REASON.RESTOCK && body.delta < 0) {
    throw invalid("delta", "a restock must add stock");
  }
  if (!body.note) {
    throw invalid("note", "a correction needs a note");
  }
  const requestHash = idempotencyKey
    ? sha256Canonical([body.productId, body.delta, body.reason, body.note])
    : undefined;
  if (!idempotencyKey) {
    logger.warn({ category: "missing_idempotency_key", actorId }, "stock adjustment missing key");
  }

  const buildResult = async (
    tx: Prisma.TransactionClient,
    movement: Prisma.StockMovementGetPayload<{ include: typeof movementInclude }>,
    created: boolean,
  ): Promise<AdjustStockResult> => {
    const product = await tx.product.findUniqueOrThrow({ where: { id: body.productId } });
    return { product: toProductDto(product), movement: toMovementDto(movement), created };
  };

  const run = () =>
    prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        const existing = await tx.stockMovement.findUnique({
          where: { actorId_idempotencyKey: { actorId, idempotencyKey } },
          include: movementInclude,
        });
        if (existing) {
          if (existing.requestHash !== requestHash) throw idempotencyConflict();
          logger.info(
            { category: "replayed", actorId, movementId: existing.id },
            "stock adjustment replayed",
          );
          return buildResult(tx, existing, false);
        }
      }
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
        note: body.note,
        idempotencyKey,
        requestHash,
      });
      const movement = await tx.stockMovement.findUniqueOrThrow({
        where: { id: created.id },
        include: movementInclude,
      });
      logger.info(
        { category: "created", actorId, movementId: movement.id },
        "stock adjustment created",
      );
      return buildResult(tx, movement, true);
    });

  try {
    return await run();
  } catch (error) {
    if (!idempotencyKey) throw error;
    const winner = await prisma.stockMovement.findUnique({
      where: { actorId_idempotencyKey: { actorId, idempotencyKey } },
      include: movementInclude,
    });
    if (!winner) throw error;
    if (winner.requestHash !== requestHash) {
      logger.warn(
        { category: "conflict", actorId, movementId: winner.id },
        "stock adjustment key conflict",
      );
      throw idempotencyConflict();
    }
    logger.info(
      { category: "replayed", actorId, movementId: winner.id },
      "stock adjustment replayed",
    );
    const product = await prisma.product.findUniqueOrThrow({ where: { id: body.productId } });
    return { product: toProductDto(product), movement: toMovementDto(winner), created: false };
  }
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
  { header: "Tồn trước", value: (m) => m.balanceBefore },
  { header: "Tồn sau", value: (m) => m.balanceAfter },
  { header: "Lý do", value: (m) => m.reason },
  { header: "Mã đơn", value: (m) => m.orderId },
  { header: "Phiếu nhập", value: (m) => m.receipt?.code },
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
