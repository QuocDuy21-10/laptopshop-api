import { prisma } from "config/client";
import { adjustStock, moveStock } from "modules/inventory/inventory.service";
import { changeStatus, placeOrder } from "modules/orders/orders.service";
import { createProduct, createUser, ledgerMatches, putInCart, receiver, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("stock ledger", () => {
  it("keeps balances contiguous across concurrent stock moves", async () => {
    const product = await createProduct(5);

    await Promise.all([
      prisma.$transaction((tx) =>
        moveStock(tx, { productId: product.id, delta: 2, reason: "RESTOCK" }),
      ),
      prisma.$transaction((tx) =>
        moveStock(tx, { productId: product.id, delta: -1, reason: "CORRECTION", note: "Mất hàng" }),
      ),
    ]);

    const rows = await prisma.stockMovement.findMany({
      where: { productId: product.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { delta: true, balanceBefore: true, balanceAfter: true },
    });
    let previous = 0;
    for (const row of rows) {
      expect(row.balanceBefore).toBe(previous);
      previous = row.balanceAfter!;
      expect(row.balanceAfter).toBe(row.balanceBefore! + row.delta);
    }
    expect(previous).toBe(
      (await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).quantity,
    );
  });

  it("keeps SUM(delta) equal to quantity through concurrent checkouts and a cancel", async () => {
    const product = await createProduct(2);
    const users = [];
    for (let i = 0; i < 4; i++) users.push(await createUser());
    for (const u of users) await putInCart(u.id, product.id, 1);

    const results = await Promise.allSettled(
      users.map((u, i) => placeOrder(u.id, `l-${i}`, receiver)),
    );
    const placed = results.filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof placeOrder>>> =>
        r.status === "fulfilled",
    );
    expect(placed).toHaveLength(2);
    expect(await ledgerMatches(product.id)).toBe(true);

    await changeStatus(placed[0].value.order.id, "CANCELLED", { actorId: users[0].id });
    expect(await ledgerMatches(product.id)).toBe(true);
    const rows = await prisma.stockMovement.findMany({
      where: { productId: product.id },
      orderBy: { id: "asc" },
      select: { reason: true, delta: true },
    });
    const linked = await prisma.stockMovement.findMany({
      where: { productId: product.id, reason: "ORDER" },
      select: { orderId: true },
    });
    expect(linked.every((m) => m.orderId !== null)).toBe(true);
    expect(rows).toEqual([
      { reason: "OPENING", delta: 2 },
      { reason: "ORDER", delta: -1 },
      { reason: "ORDER", delta: -1 },
      { reason: "ORDER_CANCEL", delta: 1 },
    ]);
  });

  it("lets only one of two concurrent corrections take the last units", async () => {
    const product = await createProduct(3);
    const admin = await createUser();
    const results = await Promise.allSettled([
      adjustStock(admin.id, { productId: product.id, delta: -2, reason: "CORRECTION", note: "a" }),
      adjustStock(admin.id, { productId: product.id, delta: -2, reason: "CORRECTION", note: "b" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).quantity).toBe(
      1,
    );
    expect(await ledgerMatches(product.id)).toBe(true);
  });
});
