import { prisma } from "config/client";

export type LedgerMismatch = {
  productId: number;
  quantity: number;
  ledgerQuantity: number;
};

type RawLedgerMismatch = {
  productId: number | bigint;
  quantity: number | bigint;
  ledgerQuantity: number | bigint;
};

export const findLedgerMismatches = async (): Promise<LedgerMismatch[]> => {
  const rows = await prisma.$queryRaw<RawLedgerMismatch[]>`
    SELECT p.id AS productId,
           p.quantity AS quantity,
           COALESCE(SUM(sm.delta), 0) AS ledgerQuantity
    FROM products p
    LEFT JOIN stock_movements sm ON sm.productId = p.id
    GROUP BY p.id, p.quantity
    HAVING p.quantity <> ledgerQuantity
  `;
  return rows.map((row) => ({
    productId: Number(row.productId),
    quantity: Number(row.quantity),
    ledgerQuantity: Number(row.ledgerQuantity),
  }));
};
