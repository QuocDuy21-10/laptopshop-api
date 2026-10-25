import { prisma } from "config/client";
import { AppError } from "lib/errors";
import { changeStatus, placeOrder } from "modules/orders/orders.service";
import { ingestPaymentTransaction } from "modules/payments/payment-ingestion.service";
import { runPaymentMaintenance } from "modules/payments/payment-maintenance.service";
import { quoteOrder } from "modules/promotions/promotions.service";
import { createProduct, createUser, ledgerMatches, putInCart, receiver, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const rejectedCodes = (results: PromiseSettledResult<unknown>[]) =>
  results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => (r.reason instanceof AppError ? r.reason.code : String(r.reason)));

const currentReceiver = async (
  userId: number,
  overrides: Partial<typeof receiver> & { paymentMethod?: "BANK_TRANSFER" } = {},
) => {
  const quote = await quoteOrder(userId);
  return { ...receiver, ...overrides, pricingFingerprint: quote.pricingFingerprint };
};

describe("checkout under concurrency", () => {
  it("never sells more than the stock", async () => {
    const product = await createProduct(2);
    const users = [];
    for (let i = 0; i < 4; i++) users.push(await createUser());
    for (const u of users) await putInCart(u.id, product.id, 1);
    const inputs = await Promise.all(users.map((user) => currentReceiver(user.id)));

    const results = await Promise.allSettled(
      users.map((u, i) => placeOrder(u.id, `key-${i}`, inputs[i])),
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
    const input = await currentReceiver(user.id);

    const first = await placeOrder(user.id, "same", input);
    const second = await placeOrder(user.id, "same", input);

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
    const input = await currentReceiver(user.id);

    const [a, b] = await Promise.all([
      placeOrder(user.id, "same", input),
      placeOrder(user.id, "same", input),
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
  it("releases Flash Sale quota and restocks once when an order is cancelled twice", async () => {
    const product = await createProduct(5);
    const user = await createUser();
    const promotion = await prisma.promotion.create({
      data: {
        kind: "FLASH_SALE",
        state: "ACTIVE",
        name: "Flash double cancel",
        discountKind: "PERCENT",
        discountValue: 20,
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 10 * 60_000),
        createdById: user.id,
        updatedById: user.id,
        flashSalePolicy: { create: { priority: 10, stackableWithCoupon: true } },
        flashSaleQuotas: { create: { productId: product.id, totalQuota: 5, maxUnitsPerUser: 5 } },
      },
    });
    await putInCart(user.id, product.id, 2);
    const quote = await quoteOrder(user.id);
    const { order } = await placeOrder(user.id, "k", {
      ...receiver,
      pricingFingerprint: quote.pricingFingerprint,
    });

    const results = await Promise.allSettled([
      changeStatus(order.id, "CANCELLED", { actorId: user.id }),
      changeStatus(order.id, "CANCELLED", { actorId: user.id }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(rejectedCodes(results)).toEqual(["INVALID_STATUS_TRANSITION"]);
    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: order.id } }),
    ).resolves.toMatchObject({ status: "CANCELLED" });
    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.quantity).toBe(5);
    expect(after.sold).toBe(0);
    await expect(ledgerMatches(product.id)).resolves.toBe(true);
    await expect(
      prisma.flashSaleProductQuota.findUniqueOrThrow({
        where: { promotionId_productId: { promotionId: promotion.id, productId: product.id } },
      }),
    ).resolves.toMatchObject({ claimedUnits: 0 });
    await expect(
      prisma.flashSaleUserUsage.findUniqueOrThrow({
        where: {
          promotionId_productId_userId: {
            promotionId: promotion.id,
            productId: product.id,
            userId: user.id,
          },
        },
      }),
    ).resolves.toMatchObject({ claimedUnits: 0 });
    await expect(
      prisma.flashSaleAllocation.findFirstOrThrow({ where: { orderId: order.id } }),
    ).resolves.toMatchObject({ status: "RELEASED", quantity: 2 });
    await expect(
      prisma.orderDetail.findFirstOrThrow({
        where: { orderId: order.id, automaticPromotionId: promotion.id },
        include: { flashSaleAllocation: true },
      }),
    ).resolves.toMatchObject({
      flashSaleAllocation: { status: "RELEASED", quantity: 2 },
    });
  });
});

describe("hidden products", () => {
  it("refuses to check out a product hidden after it was added to the cart", async () => {
    const product = await createProduct(3);
    const user = await createUser();
    await putInCart(user.id, product.id, 1);
    const input = await currentReceiver(user.id);
    await prisma.product.update({ where: { id: product.id }, data: { isActive: false } });

    await expect(placeOrder(user.id, "k", input)).rejects.toMatchObject({
      code: "PRODUCT_UNAVAILABLE",
    });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).quantity).toBe(
      3,
    );
    expect(await prisma.order.count()).toBe(0);
  });
});

describe("bank transfer payments", () => {
  it("creates one pending payment with a unique transfer code", async () => {
    const product = await createProduct(3, 1000);
    const user = await createUser();
    await putInCart(user.id, product.id, 2);
    const { order } = await placeOrder(
      user.id,
      "qr-1",
      await currentReceiver(user.id, { paymentMethod: "BANK_TRANSFER" }),
    );
    const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(payment.status).toBe("PENDING");
    expect(payment.transferCode).toMatch(/^LS[A-Z0-9]{12}$/);
    expect(payment.amount).toBe(2000);
    expect(payment.cancelAfter.getTime()).toBeGreaterThan(payment.expiresAt.getTime());
  });

  it("confirms an exact transaction once and ignores a duplicate", async () => {
    const product = await createProduct(3, 1000);
    const user = await createUser();
    await putInCart(user.id, product.id, 1);
    const { order } = await placeOrder(
      user.id,
      "qr-2",
      await currentReceiver(user.id, { paymentMethod: "BANK_TRANSFER" }),
    );
    const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } });
    const transaction = {
      providerEventId: "event-1",
      providerTransactionKey: "tx-1",
      direction: "IN" as const,
      amount: payment.amount,
      currency: "VND",
      transferCode: payment.transferCode,
      accountNumber: payment.accountNumber,
      occurredAt: new Date(payment.expiresAt.getTime() - 1000),
    };
    await expect(
      ingestPaymentTransaction({ provider: "fake", mode: "test" }, transaction, "WEBHOOK"),
    ).resolves.toMatchObject({
      status: "MATCHED",
    });
    await expect(
      ingestPaymentTransaction({ provider: "fake", mode: "test" }, transaction, "RECONCILIATION"),
    ).resolves.toMatchObject({
      duplicate: true,
    });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      "SUCCEEDED",
    );
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe(
      "PAYMENT_SUCCESS",
    );
  });

  it("moves an unpaid QR payment through verification and restores stock once after evidence", async () => {
    const product = await createProduct(2, 1000);
    const user = await createUser();
    await putInCart(user.id, product.id, 1);
    const { order } = await placeOrder(
      user.id,
      "qr-3",
      await currentReceiver(user.id, { paymentMethod: "BANK_TRANSFER" }),
    );
    const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } });
    const verifyingAt = new Date(payment.expiresAt.getTime() + 1);
    expect(await runPaymentMaintenance(verifyingAt)).toMatchObject({ verifying: 1, expired: 0 });
    const evidenceAt = new Date(payment.cancelAfter.getTime() + 5 * 60_000 + 1);
    await prisma.paymentProviderCheckpoint.create({
      data: {
        provider: "fake",
        mode: "test",
        previousVerifiedThroughAt: evidenceAt,
        verifiedThroughAt: evidenceAt,
        consecutiveSuccesses: 2,
      },
    });
    expect(await runPaymentMaintenance(evidenceAt)).toMatchObject({ expired: 1 });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      "EXPIRED",
    );
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      "CANCELLED",
    );
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).quantity).toBe(
      2,
    );
    expect(await runPaymentMaintenance(evidenceAt)).toMatchObject({ expired: 0 });
  });

  it("lets a valid webhook win without releasing stock when expiry has no evidence", async () => {
    const product = await createProduct(2, 1000);
    const user = await createUser();
    await putInCart(user.id, product.id, 1);
    const { order } = await placeOrder(
      user.id,
      "qr-race",
      await currentReceiver(user.id, { paymentMethod: "BANK_TRANSFER" }),
    );
    const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } });
    const now = new Date(payment.expiresAt.getTime() + 1);
    const transaction = {
      providerEventId: "race-event",
      providerTransactionKey: "race-tx",
      direction: "IN" as const,
      amount: payment.amount,
      currency: "VND",
      transferCode: payment.transferCode,
      accountNumber: payment.accountNumber,
      occurredAt: new Date(payment.expiresAt.getTime() - 1),
    };

    await runPaymentMaintenance(now);
    await ingestPaymentTransaction({ provider: "fake", mode: "test" }, transaction, "WEBHOOK");
    await expect(
      prisma.payment.findUniqueOrThrow({ where: { id: payment.id } }),
    ).resolves.toMatchObject({
      status: "SUCCEEDED",
    });
    await expect(
      prisma.product.findUniqueOrThrow({ where: { id: product.id } }),
    ).resolves.toMatchObject({
      quantity: 1,
    });
  });

  it("does not double-restock when two maintenance workers race", async () => {
    const product = await createProduct(2, 1000);
    const user = await createUser();
    await putInCart(user.id, product.id, 1);
    const { order } = await placeOrder(
      user.id,
      "qr-workers",
      await currentReceiver(user.id, { paymentMethod: "BANK_TRANSFER" }),
    );
    const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } });
    const verifyingAt = new Date(payment.expiresAt.getTime() + 1);
    await runPaymentMaintenance(verifyingAt);
    const evidenceAt = new Date(payment.cancelAfter.getTime() + 5 * 60_000 + 1);
    await prisma.paymentProviderCheckpoint.create({
      data: {
        provider: "fake",
        mode: "test",
        previousVerifiedThroughAt: evidenceAt,
        verifiedThroughAt: evidenceAt,
        consecutiveSuccesses: 2,
      },
    });

    await Promise.all([runPaymentMaintenance(evidenceAt), runPaymentMaintenance(evidenceAt)]);
    await expect(
      prisma.product.findUniqueOrThrow({ where: { id: product.id } }),
    ).resolves.toMatchObject({
      quantity: 2,
    });
  });

  it("does not expire a payment after fulfillment already left pending", async () => {
    const product = await createProduct(2, 1000);
    const user = await createUser();
    await putInCart(user.id, product.id, 1);
    const { order } = await placeOrder(
      user.id,
      "qr-4",
      await currentReceiver(user.id, { paymentMethod: "BANK_TRANSFER" }),
    );
    await prisma.order.update({ where: { id: order.id }, data: { status: "SHIPPING" } });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(await runPaymentMaintenance(new Date(payment.cancelAfter.getTime() + 1))).toMatchObject({
      verifying: 0,
      expired: 0,
    });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      "PENDING",
    );
  });
});

describe("order status history", () => {
  it("records each transition and the completion time", async () => {
    const product = await createProduct(5);
    const user = await createUser();
    await putInCart(user.id, product.id, 1);
    const { order } = await placeOrder(user.id, "h", await currentReceiver(user.id));
    await changeStatus(order.id, "SHIPPING", { actorId: user.id });
    await changeStatus(order.id, "COMPLETED", { actorId: user.id });

    const history = await prisma.orderStatusHistory.findMany({
      where: { orderId: order.id },
      orderBy: { id: "asc" },
    });
    expect(history.map((h) => [h.fromStatus, h.toStatus])).toEqual([
      [null, "PENDING"],
      ["PENDING", "SHIPPING"],
      ["SHIPPING", "COMPLETED"],
    ]);
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(saved.completedAt).toBeInstanceOf(Date);
  });
});
