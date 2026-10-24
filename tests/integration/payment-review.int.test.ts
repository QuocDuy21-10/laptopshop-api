import { prisma } from "config/client";
import { ingestPaymentTransaction } from "modules/payments/payment-ingestion.service";
import { releasePaymentReviewCase } from "modules/payments/payment-review.service";
import { createProduct, createUser, putInCart, receiver, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("payment review provider race", () => {
  it("does not release stock after provider confirmation wins", async () => {
    const product = await createProduct(2, 1000);
    const user = await createUser();
    await putInCart(user.id, product.id, 1);
    const { order } = await (
      await import("modules/orders/orders.service")
    ).placeOrder(user.id, "review-race", {
      ...receiver,
      paymentMethod: "BANK_TRANSFER",
    });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } });
    const reviewCase = await prisma.paymentReviewCase.create({
      data: { paymentId: payment.id, reason: "RECONCILIATION_INCONCLUSIVE" },
    });
    const transaction = {
      providerEventId: "review-race-event",
      providerTransactionKey: "review-race-tx",
      direction: "IN" as const,
      amount: payment.amount,
      currency: payment.currency,
      transferCode: payment.transferCode,
      accountNumber: payment.accountNumber,
      occurredAt: new Date(payment.expiresAt.getTime() - 1),
    };

    await ingestPaymentTransaction({ provider: "fake", mode: "test" }, transaction, "WEBHOOK");
    await expect(
      releasePaymentReviewCase(reviewCase.id, user.id, {
        version: 0,
        note: "release",
        confirmation: "RELEASE_STOCK",
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_REVIEW_CASE_VERSION_CONFLICT" });
    await expect(
      prisma.product.findUniqueOrThrow({ where: { id: product.id } }),
    ).resolves.toMatchObject({
      quantity: 1,
    });
  });
});
