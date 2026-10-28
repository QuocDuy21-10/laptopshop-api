import { Prisma } from "@prisma/client";
import { toActor } from "lib/actor";

export const movementInclude = {
  product: { select: { name: true } },
  actor: { select: { id: true, fullName: true, username: true } },
  receipt: { select: { code: true } },
} satisfies Prisma.StockMovementInclude;
export type MovementRow = Prisma.StockMovementGetPayload<{ include: typeof movementInclude }>;

export const toMovementDto = (m: MovementRow) => ({
  id: m.id,
  productId: m.productId,
  productName: m.product.name,
  delta: m.delta,
  balanceBefore: m.balanceBefore,
  balanceAfter: m.balanceAfter,
  reason: m.reason,
  orderId: m.orderId,
  receiptId: m.receiptId,
  receiptCode: m.receipt?.code ?? null,
  actor: toActor(m.actor),
  note: m.note,
  createdAt: m.createdAt,
});
export type MovementDto = ReturnType<typeof toMovementDto>;
