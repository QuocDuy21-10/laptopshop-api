import type { Prisma } from "@prisma/client";

import type { StockReason } from "modules/inventory/inventory.schema";

export type StockMove = {
  productId: number;
  delta: number;
  reason: StockReason;
  at: Date;
  orderId?: number;
  receiptId?: string;
  actorId?: number | null;
  note?: string;
};

export type StockLedger = {
  move: (m: StockMove) => void;
  balance: (productId: number) => number;
  sold: (productId: number) => number;
  movements: Prisma.StockMovementCreateManyInput[];
};

// same quantity/sold rules as moveStock in modules/inventory/inventory.service.ts
export const createStockLedger = (
  opening: { productId: number; quantity: number; at: Date }[],
): StockLedger => {
  const balances = new Map<number, number>();
  const sold = new Map<number, number>();
  const movements: Prisma.StockMovementCreateManyInput[] = [];
  const balance = (productId: number) => balances.get(productId) ?? 0;
  const move = (m: StockMove) => {
    const before = balance(m.productId);
    const after = before + m.delta;
    if (after < 0) throw new Error(`demo seed: stock of product ${m.productId} would go negative`);
    balances.set(m.productId, after);
    // ORDER has a negative delta (sold goes up), ORDER_CANCEL a positive one (sold goes down)
    if (m.reason === "ORDER" || m.reason === "ORDER_CANCEL")
      sold.set(m.productId, (sold.get(m.productId) ?? 0) - m.delta);
    movements.push({
      productId: m.productId,
      delta: m.delta,
      reason: m.reason,
      balanceBefore: before,
      balanceAfter: after,
      createdAt: m.at,
      orderId: m.orderId ?? null,
      receiptId: m.receiptId ?? null,
      actorId: m.actorId ?? null,
      note: m.note ?? null,
    });
  };
  opening.forEach((o) =>
    move({ productId: o.productId, delta: o.quantity, reason: "OPENING", at: o.at }),
  );
  return { move, balance, sold: (productId) => sold.get(productId) ?? 0, movements };
};
