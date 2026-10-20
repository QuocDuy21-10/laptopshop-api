import fs from "fs";
import path from "path";
import { prisma } from "config/client";
import { createProduct, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("inventory balance contract migration", () => {
  it("backfills same-timestamp movements by id order", async () => {
    const product = await createProduct(0);
    await prisma.product.update({ where: { id: product.id }, data: { quantity: 6 } });
    const createdAt = new Date("2026-10-20T03:00:00.000Z");
    for (const delta of [1, 2, 3]) {
      await prisma.stockMovement.create({
        data: {
          productId: product.id,
          delta,
          reason: "RESTOCK",
          createdAt,
          balanceBefore: 999,
          balanceAfter: 999,
        },
      });
    }
    const migration = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../prisma/migrations/20261020193000_inventory_balance_contract/migration.sql",
      ),
      "utf8",
    );
    const backfill = migration.split("-- BACKFILL_START")[1].split("-- BACKFILL_END")[0].trim();
    await prisma.$executeRawUnsafe(backfill);

    const rows = await prisma.stockMovement.findMany({
      where: { productId: product.id },
      orderBy: { id: "asc" },
      select: { delta: true, balanceBefore: true, balanceAfter: true },
    });
    expect(rows.map((row) => [row.balanceBefore, row.balanceAfter])).toEqual([
      [0, 1],
      [1, 3],
      [3, 6],
    ]);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).quantity).toBe(
      6,
    );
  });
});
