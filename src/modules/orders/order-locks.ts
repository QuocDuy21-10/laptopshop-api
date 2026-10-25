import { Prisma } from "@prisma/client";

export const lockProductRows = async (
  tx: Prisma.TransactionClient,
  productIds: number[],
): Promise<void> => {
  const ids = [...new Set(productIds)].sort((a, b) => a - b);
  if (ids.length === 0) return;
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM products WHERE id IN (${Prisma.join(ids)}) ORDER BY id ASC FOR UPDATE`,
  );
};
