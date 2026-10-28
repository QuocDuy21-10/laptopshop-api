jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import { ingestPaymentTransaction } from "modules/payments/payment-ingestion.service";
import { prismaError, prismaMock, resetPrisma } from "../../helpers/prisma";

const authority = { provider: "fake" as const, mode: "test" as const };
const transaction = {
  providerEventId: "event-1",
  providerTransactionKey: "tx-1",
  direction: "IN" as const,
  amount: 1000,
  currency: "VND",
  transferCode: "LSABC12345678",
  accountNumber: "0123456789",
  occurredAt: new Date("2026-10-19T09:59:00.000Z"),
};
const payment = {
  id: "pay-1",
  orderId: 50,
  provider: "fake",
  providerMode: "test",
  status: "PENDING",
  amount: 1000,
  currency: "VND",
  transferCode: "LSABC12345678",
  accountNumber: "0123456789",
  expiresAt: new Date("2026-10-19T10:00:00.000Z"),
  order: { id: 50, userId: 1, status: "PENDING", paymentStatus: "PAYMENT_UNPAID" },
};

beforeEach(resetPrisma);

describe("ingestPaymentTransaction", () => {
  it("reviews a payment matched by code but owned by another provider authority", async () => {
    prismaMock.paymentWebhookEvent.findMany.mockResolvedValue([]);
    prismaMock.payment.findUnique.mockResolvedValue({
      ...payment,
      provider: "sepay",
      providerMode: "live",
    });
    prismaMock.paymentWebhookEvent.create.mockResolvedValue({});

    const result = await ingestPaymentTransaction(authority, transaction, "WEBHOOK");

    expect(result).toMatchObject({ status: "REVIEW_REQUIRED", paymentId: "pay-1" });
    expect(prismaMock.paymentWebhookEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reviewReason: "PROVIDER_MISMATCH" }),
      }),
    );
    expect(prismaMock.order.updateMany).not.toHaveBeenCalled();
  });

  it("returns the stored review status for a duplicate event", async () => {
    prismaMock.paymentWebhookEvent.findMany.mockResolvedValue([
      { id: "event-row", status: "REVIEW_REQUIRED", paymentId: "pay-1" },
    ]);

    await expect(
      ingestPaymentTransaction(authority, transaction, "RECONCILIATION"),
    ).resolves.toEqual({
      duplicate: true,
      status: "REVIEW_REQUIRED",
      paymentId: "pay-1",
    });
    expect(prismaMock.paymentWebhookEvent.create).not.toHaveBeenCalled();
  });

  it("rejects an event whose two identity keys resolve to different rows", async () => {
    prismaMock.paymentWebhookEvent.findMany.mockResolvedValue([
      { id: "event-row", status: "MATCHED", paymentId: "pay-1" },
      { id: "tx-row", status: "REVIEW_REQUIRED", paymentId: "pay-2" },
    ]);

    await expect(ingestPaymentTransaction(authority, transaction, "WEBHOOK")).rejects.toMatchObject(
      {
        code: "PAYMENT_EVENT_IDENTITY_CONFLICT",
      },
    );
  });

  it.each(["PENDING", "VERIFYING", "REVIEW_REQUIRED"] as const)(
    "confirms a valid transaction when payment is %s",
    async (status) => {
      prismaMock.paymentWebhookEvent.findMany.mockResolvedValue([]);
      prismaMock.payment.findUnique.mockResolvedValue({ ...payment, status });
      prismaMock.order.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.payment.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.paymentWebhookEvent.create.mockResolvedValue({});

      await expect(
        ingestPaymentTransaction(authority, transaction, "WEBHOOK"),
      ).resolves.toMatchObject({
        status: "MATCHED",
      });
      expect(prismaMock.paymentReviewCase.updateMany).toHaveBeenCalled();
    },
  );

  it.each([
    ["a matched code", payment],
    ["no code", null],
  ])("stores an outbound transaction with %s as resolved, not for review", async (_, row) => {
    prismaMock.paymentWebhookEvent.findMany.mockResolvedValue([]);
    prismaMock.payment.findUnique.mockResolvedValue(row);
    prismaMock.paymentWebhookEvent.create.mockResolvedValue({});

    await expect(
      ingestPaymentTransaction(authority, { ...transaction, direction: "OUT" }, "WEBHOOK"),
    ).resolves.toMatchObject({ status: "RESOLVED" });
    expect(prismaMock.paymentWebhookEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "RESOLVED",
        reviewReason: "OUTBOUND",
        resolvedAt: expect.any(Date),
      }),
    });
    expect(prismaMock.order.updateMany).not.toHaveBeenCalled();
  });

  it("rethrows an unrelated unique error instead of labeling it matched", async () => {
    prismaMock.paymentWebhookEvent.findMany.mockResolvedValue([]);
    prismaMock.payment.findUnique.mockResolvedValue(null);
    prismaMock.paymentWebhookEvent.create.mockRejectedValue(prismaError("P2002"));
    prismaMock.paymentWebhookEvent.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await expect(ingestPaymentTransaction(authority, transaction, "WEBHOOK")).rejects.toMatchObject(
      {
        code: "P2002",
      },
    );
  });
});
