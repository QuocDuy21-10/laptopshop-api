import { Prisma } from "@prisma/client";

export type LockedProductRow = {
  id: number;
  price: number;
  isActive: boolean;
  warrantyMonths: number | null;
};

export const lockProductRows = async (
  tx: Prisma.TransactionClient,
  productIds: number[],
): Promise<LockedProductRow[]> => {
  const ids = [...new Set(productIds)].sort((a, b) => a - b);
  if (ids.length === 0) return [];
  return tx.$queryRaw<LockedProductRow[]>(
    Prisma.sql`SELECT id, price, isActive, warrantyMonths FROM products WHERE id IN (${Prisma.join(ids)}) ORDER BY id ASC FOR UPDATE`,
  );
};
