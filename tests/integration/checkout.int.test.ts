import { prisma } from "config/client";
import { AppError } from "lib/errors";
import { changeStatus, placeOrder } from "modules/orders/orders.service";
import { createProduct, createUser, putInCart, receiver, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const rejectedCodes = (results: PromiseSettledResult<unknown>[]) =>
  results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => (r.reason instanceof AppError ? r.reason.code : String(r.reason)));

describe("checkout under concurrency", () => {
  it("never sells more than the stock", async () => {
    const product = await createProduct(2);
    const users = [];
    for (let i = 0; i < 4; i++) users.push(await createUser());
    for (const u of users) await putInCart(u.id, product.id, 1);

    const results = await Promise.allSettled(
      users.map((u, i) => placeOrder(u.id, `key-${i}`, receiver)),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(rejectedCodes(results)).toEqual(["OUT_OF_STOCK", "OUT_OF_STOCK"]);
    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.quantity).toBe(0);
    expect(after.sold).toBe(2);
    expect(await prisma.order.count()).toBe(2);
  });

  it("replays the same order for a repeated key", async () => {
    const product = await createProduct(5, 300);
    const user = await createUser();
    await putInCart(user.id, product.id, 2);

    const first = await placeOrder(user.id, "same", receiver);
    const second = await placeOrder(user.id, "same", receiver);

    expect(first.created).toBe(true);
    expect(first.order.totalPrice).toBe(600);
    expect(second).toEqual({ order: first.order, created: false });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).quantity).toBe(
      3,
    );
  });

  it("creates one order for concurrent requests with one key", async () => {
    const product = await createProduct(1);
    const user = await createUser();
    await putInCart(user.id, product.id, 1);

    const [a, b] = await Promise.all([
      placeOrder(user.id, "same", receiver),
      placeOrder(user.id, "same", receiver),
    ]);

    expect(a.order.id).toBe(b.order.id);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect(await prisma.order.count()).toBe(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).quantity).toBe(
      0,
    );
  });
});

describe("cancellation under concurrency", () => {
  it("restocks once when an order is cancelled twice at the same time", async () => {
    const product = await createProduct(5);
    const user = await createUser();
    await putInCart(user.id, product.id, 2);
    const { order } = await placeOrder(user.id, "k", receiver);

    const results = await Promise.allSettled([
      changeStatus(order.id, "CANCELLED"),
      changeStatus(order.id, "CANCELLED"),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(rejectedCodes(results)).toEqual(["INVALID_STATUS_TRANSITION"]);
    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.quantity).toBe(5);
    expect(after.sold).toBe(0);
  });
});

describe("hidden products", () => {
  it("refuses to check out a product hidden after it was added to the cart", async () => {
    const product = await createProduct(3);
    const user = await createUser();
    await putInCart(user.id, product.id, 1);
    await prisma.product.update({ where: { id: product.id }, data: { isActive: false } });

    await expect(placeOrder(user.id, "k", receiver)).rejects.toMatchObject({
      code: "PRODUCT_UNAVAILABLE",
    });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).quantity).toBe(
      3,
    );
    expect(await prisma.order.count()).toBe(0);
  });
});
