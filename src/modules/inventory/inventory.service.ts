import { Prisma } from "@prisma/client";
import { isNotFound, notFound } from "lib/errors";
import { outOfStock } from "modules/cart/cart.service";
import { STOCK_REASON, StockReason } from "modules/inventory/inventory.schema";

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
