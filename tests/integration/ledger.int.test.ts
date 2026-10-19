import { prisma } from "config/client";
import { changeStatus, placeOrder } from "modules/orders/orders.service";
import { createProduct, createUser, ledgerMatches, putInCart, receiver, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("stock ledger", () => {
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
});
