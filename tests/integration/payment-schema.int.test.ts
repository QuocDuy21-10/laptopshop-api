import { prisma } from "config/client";
import { placeOrder } from "modules/orders/orders.service";
import { createProduct, createUser, putInCart, receiver, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("payment safety schema", () => {
  it("snapshots fake test authority and a finite review deadline on checkout", async () => {
    const product = await createProduct(2, 1000);
    const user = await createUser();
    await putInCart(user.id, product.id, 1);

    const { order } = await placeOrder(user.id, "schema-payment", {
      ...receiver,
      paymentMethod: "BANK_TRANSFER",
    });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } });

    expect(payment.providerMode).toBe("test");
    expect(payment.reviewAfter.getTime()).toBeGreaterThan(payment.cancelAfter.getTime());
  });

  it("persists review cases and audited actions against one payment", async () => {
    const product = await createProduct(1, 1000);
    const user = await createUser();
    await putInCart(user.id, product.id, 1);
    const { order } = await placeOrder(user.id, "schema-review", {
      ...receiver,
      paymentMethod: "BANK_TRANSFER",
    });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } });

    const reviewCase = await prisma.paymentReviewCase.create({
      data: {
        paymentId: payment.id,
        reason: "RECONCILIATION_INCONCLUSIVE",
        nextReviewAt: new Date(Date.now() + 60_000),
      },
    });
    const action = await prisma.paymentReviewAction.create({
      data: {
        reviewCaseId: reviewCase.id,
        actorId: user.id,
        action: "EXTEND_HOLD",
        note: "Theo dõi thêm",
        holdUntil: new Date(Date.now() + 120_000),
      },
    });

    await expect(
      prisma.paymentReviewCase.findUnique({
        where: { id: reviewCase.id },
        include: { actions: true },
      }),
    ).resolves.toMatchObject({ paymentId: payment.id, actions: [{ id: action.id }] });
  });
});
