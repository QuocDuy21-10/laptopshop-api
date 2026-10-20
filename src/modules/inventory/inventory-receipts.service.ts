import { Prisma } from "@prisma/client";
import crypto from "crypto";
import { prisma } from "config/client";
import { AppError, isUniqueViolation, notFound } from "lib/errors";
import { pageArgs, pageMeta } from "lib/http";
import { assertDayRange, createdAtRange } from "lib/shop-time";
import { logger } from "lib/logger";
import { withPrismaTransactionRetry } from "lib/prisma-retry";
import { moveStock } from "modules/inventory/inventory.service";
import {
  movementInclude,
  toMovementDto,
  type MovementDto,
} from "modules/inventory/inventory.mapper";
import {
  CreateReceiptBody,
  ListReceiptsQuery,
  RECEIPT_STATUS,
  UpdateReceiptBody,
} from "modules/inventory/inventory-receipts.schema";
import {
  receiptDetailInclude,
  receiptSummaryInclude,
  toReceiptDetailDto,
  toReceiptSummaryDto,
  type ReceiptDetailDto,
} from "modules/inventory/inventory-receipts.mapper";
import { generateReceiptCode } from "modules/inventory/inventory-receipts.schema";

const unavailableProducts = (productIds: number[]) =>
  new AppError("Some receipt products are unavailable", 409, "PRODUCT_UNAVAILABLE", {
    productIds,
  });

const assertProductsAvailable = async (
  client: Prisma.TransactionClient | typeof prisma,
  items: CreateReceiptBody["items"],
) => {
  const ids = items.map((item) => item.productId);
  const products = await client.product.findMany({
    where: { id: { in: ids }, isActive: true },
    select: { id: true },
  });
  const available = new Set(products.map((product) => product.id));
  const missing = ids.filter((id) => !available.has(id));
  if (missing.length) throw unavailableProducts([...new Set(missing)]);
};

const createReceiptAttempt = async (actorId: number, body: CreateReceiptBody) =>
  prisma.$transaction(async (tx) => {
    await assertProductsAvailable(tx, body.items);
    const created = await tx.stockReceipt.create({
      data: {
        code: generateReceiptCode(new Date(), crypto.randomUUID()),
        supplierName: body.supplierName,
        note: body.note,
        status: RECEIPT_STATUS.DRAFT,
        createdById: actorId,
        items: {
          create: body.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitCost: item.unitCost,
          })),
        },
      },
      include: receiptDetailInclude,
    });
    return toReceiptDetailDto(created);
  });

export const createReceipt = async (actorId: number, body: CreateReceiptBody) => {
  const startedAt = Date.now();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await createReceiptAttempt(actorId, body);
      logger.info(
        {
          receiptId: result.id,
          receiptCode: result.code,
          actorId,
          itemCount: result.items.length,
          durationMs: Date.now() - startedAt,
        },
        "stock receipt created",
      );
      return result;
    } catch (error) {
      if (!isUniqueViolation(error) || attempt === 2) throw error;
    }
  }
  throw new Error("unreachable");
};

export const receiptWhere = (query: Omit<ListReceiptsQuery, "page" | "pageSize">) => {
  assertDayRange(query.from, query.to);
  return {
    ...(query.status ? { status: query.status } : {}),
    ...(query.q
      ? { OR: [{ code: { contains: query.q } }, { supplierName: { contains: query.q } }] }
      : {}),
    ...createdAtRange(query.from, query.to),
  } satisfies Prisma.StockReceiptWhereInput;
};

export const listReceipts = async (query: ListReceiptsQuery) => {
  const where = receiptWhere(query);
  const [total, rows] = await Promise.all([
    prisma.stockReceipt.count({ where }),
    prisma.stockReceipt.findMany({
      where,
      include: receiptSummaryInclude,
      orderBy: [{ createdAt: "desc" }, { code: "desc" }],
      ...pageArgs(query),
    }),
  ]);
  return { items: rows.map(toReceiptSummaryDto), meta: pageMeta(query, total) };
};

export const getReceipt = async (id: string) => {
  const receipt = await prisma.stockReceipt.findUnique({
    where: { id },
    include: receiptDetailInclude,
  });
  if (!receipt) throw notFound("Stock receipt");
  return toReceiptDetailDto(receipt);
};

export const updateReceipt = async (id: string, body: UpdateReceiptBody) => {
  const startedAt = Date.now();
  const result = await prisma.$transaction(async (tx) => {
    if (body.items) await assertProductsAvailable(tx, body.items);
    const claimed = await tx.stockReceipt.updateMany({
      where: { id, status: RECEIPT_STATUS.DRAFT },
      data: {
        status: RECEIPT_STATUS.DRAFT,
        ...(body.supplierName !== undefined ? { supplierName: body.supplierName } : {}),
        ...(body.note !== undefined ? { note: body.note } : {}),
      },
    });
    if (claimed.count !== 1) {
      const existing = await tx.stockReceipt.findUnique({ where: { id }, select: { id: true } });
      if (!existing) throw notFound("Stock receipt");
      throw new AppError("Stock receipt is not a draft", 409, "INVALID_RECEIPT_STATUS");
    }
    if (body.items) {
      await tx.stockReceiptItem.deleteMany({ where: { receiptId: id } });
      await tx.stockReceiptItem.createMany({
        data: body.items.map((item) => ({
          receiptId: id,
          productId: item.productId,
          quantity: item.quantity,
          unitCost: item.unitCost,
        })),
      });
    }
    return tx.stockReceipt.findUniqueOrThrow({ where: { id }, include: receiptDetailInclude });
  });
  const mapped = toReceiptDetailDto(result);
  logger.info(
    {
      receiptId: mapped.id,
      receiptCode: mapped.code,
      itemCount: mapped.items.length,
      durationMs: Date.now() - startedAt,
    },
    "stock receipt updated",
  );
  return mapped;
};

export type PostReceiptResult = {
  receipt: ReceiptDetailDto;
  movements: MovementDto[];
  created: boolean;
};

export const postReceipt = async (id: string, actorId: number): Promise<PostReceiptResult> => {
  const startedAt = Date.now();
  const result = await withPrismaTransactionRetry(() =>
    prisma.$transaction(async (tx) => {
      const claimed = await tx.stockReceipt.updateMany({
        where: { id, status: RECEIPT_STATUS.DRAFT },
        data: { status: RECEIPT_STATUS.POSTED, postedById: actorId, postedAt: new Date() },
      });
      if (claimed.count !== 1) {
        const existing = await tx.stockReceipt.findUnique({
          where: { id },
          include: receiptDetailInclude,
        });
        if (!existing) throw notFound("Stock receipt");
        if (existing.status === RECEIPT_STATUS.POSTED) {
          const receipt = toReceiptDetailDto(existing);
          return {
            receipt,
            movements: receipt.movements,
            created: false,
          };
        }
        throw new AppError("Stock receipt is not a draft", 409, "INVALID_RECEIPT_STATUS");
      }

      const items = await tx.stockReceiptItem.findMany({
        where: { receiptId: id },
        orderBy: { productId: "asc" },
      });
      if (items.length === 0) {
        throw new AppError("Stock receipt is empty", 400, "EMPTY_RECEIPT");
      }
      await assertProductsAvailable(
        tx,
        items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          unitCost: item.unitCost ?? undefined,
        })),
      );

      for (const item of items) {
        await moveStock(tx, {
          productId: item.productId,
          delta: item.quantity,
          reason: "RESTOCK",
          actorId,
          receiptId: id,
          onlyActive: true,
        });
      }

      const receiptRow = await tx.stockReceipt.findUniqueOrThrow({
        where: { id },
        include: receiptDetailInclude,
      });
      const movementRows = await tx.stockMovement.findMany({
        where: { receiptId: id },
        include: movementInclude,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      return {
        receipt: toReceiptDetailDto(receiptRow),
        movements: movementRows.map(toMovementDto),
        created: true,
      };
    }),
  );
  logger.info(
    {
      receiptId: result.receipt.id,
      actorId,
      itemCount: result.receipt.items.length,
      movementCount: result.movements.length,
      created: result.created,
      durationMs: Date.now() - startedAt,
    },
    "stock receipt posted",
  );
  return result;
};
