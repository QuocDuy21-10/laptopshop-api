jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));
jest.mock("config/env", () => ({
  env: {
    SEPAY_MODE: "test",
    PAYMENT_RECONCILIATION_SETTLEMENT_SECONDS: 300,
  },
}));
jest.mock("modules/payments/payment-provider.factory", () => ({
  paymentProvider: () => ({ authority: { provider: "fake", mode: "test" } }),
}));
jest.mock("modules/orders/order-cancellation.service", () => ({ cancelOrder: jest.fn() }));

import { prismaError, prismaMock, resetPrisma } from "../../helpers/prisma";
import { cancelOrder } from "modules/orders/order-cancellation.service";
import { runPaymentMaintenance } from "modules/payments/payment-maintenance.service";

const now = new Date("2026-10-24T10:00:00.000Z");
const payment = {
  id: "pay-1",
  orderId: 50,
  provider: "fake",
  providerMode: "test",
  status: "PENDING",
  expiresAt: new Date("2026-10-24T09:45:00.000Z"),
  cancelAfter: new Date("2026-10-24T09:47:00.000Z"),
  reviewAfter: new Date("2026-10-24T10:45:00.000Z"),
  order: { status: "PENDING" },
};

beforeEach(resetPrisma);

describe("runPaymentMaintenance", () => {
  it("moves an expired QR payment to verifying without releasing stock", async () => {
    prismaMock.payment.findMany.mockResolvedValue([payment]);
    prismaMock.payment.updateMany.mockResolvedValue({ count: 1 });

    await expect(runPaymentMaintenance(now)).resolves.toMatchObject({ verifying: 1, expired: 0 });
    expect(prismaMock.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "VERIFYING" } }),
    );
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it("does not expire verifying payment without two verified boundaries", async () => {
    prismaMock.payment.findMany.mockResolvedValue([{ ...payment, status: "VERIFYING" }]);
    prismaMock.paymentProviderCheckpoint.findFirst.mockResolvedValue({
      consecutiveSuccesses: 1,
      previousVerifiedThroughAt: new Date("2026-10-24T09:50:00.000Z"),
      verifiedThroughAt: new Date("2026-10-24T09:55:00.000Z"),
    });

    await expect(runPaymentMaintenance(now)).resolves.toMatchObject({ expired: 0, escalated: 0 });
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it("does not use a different provider mode checkpoint", async () => {
    prismaMock.payment.findMany.mockResolvedValue([
      { ...payment, status: "VERIFYING", providerMode: "live" },
    ]);
    prismaMock.paymentProviderCheckpoint.findFirst.mockResolvedValue({
      consecutiveSuccesses: 2,
      previousVerifiedThroughAt: new Date("2026-10-24T09:55:00.000Z"),
      verifiedThroughAt: new Date("2026-10-24T09:58:00.000Z"),
    });

    await expect(runPaymentMaintenance(now)).resolves.toMatchObject({ expired: 0 });
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it("rechecks evidence while holding the expiry transaction", async () => {
    prismaMock.payment.findMany.mockResolvedValue([{ ...payment, status: "VERIFYING" }]);
    prismaMock.paymentProviderCheckpoint.findFirst
      .mockResolvedValueOnce({
        consecutiveSuccesses: 2,
        previousVerifiedThroughAt: new Date("2026-10-24T09:55:00.000Z"),
        verifiedThroughAt: new Date("2026-10-24T09:58:00.000Z"),
      })
      .mockResolvedValueOnce({
        consecutiveSuccesses: 0,
        previousVerifiedThroughAt: null,
        verifiedThroughAt: null,
      });

    await expect(runPaymentMaintenance(now)).resolves.toMatchObject({ expired: 0 });
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it("creates the review case in the same transaction as the state escalation", async () => {
    prismaMock.payment.findMany.mockResolvedValue([
      { ...payment, status: "VERIFYING", reviewAfter: new Date("2026-10-24T09:59:00.000Z") },
    ]);
    prismaMock.$transaction.mockImplementation(async (callback: any) => callback(prismaMock));
    prismaMock.payment.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.paymentReviewCase.upsert.mockResolvedValue({});

    await runPaymentMaintenance(now);
    expect(prismaMock.$transaction).toHaveBeenCalled();
  });

  it("expires only after two successful boundaries before reviewAfter", async () => {
    prismaMock.payment.findMany.mockResolvedValue([{ ...payment, status: "VERIFYING" }]);
    prismaMock.paymentProviderCheckpoint.findFirst.mockResolvedValue({
      consecutiveSuccesses: 2,
      previousVerifiedThroughAt: new Date("2026-10-24T09:55:00.000Z"),
      verifiedThroughAt: new Date("2026-10-24T09:58:00.000Z"),
    });
    prismaMock.$transaction.mockImplementation(async (callback: any) => callback(prismaMock));
    (cancelOrder as jest.Mock).mockResolvedValue({});

    await expect(runPaymentMaintenance(now)).resolves.toMatchObject({ expired: 1 });
    expect(cancelOrder).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({ paymentDisposition: "EXPIRE", orderId: 50 }),
    );
  });

  it("retries the complete expiry transaction after a deadlock", async () => {
    prismaMock.payment.findMany.mockResolvedValue([{ ...payment, status: "VERIFYING" }]);
    prismaMock.paymentProviderCheckpoint.findFirst.mockResolvedValue({
      consecutiveSuccesses: 2,
      previousVerifiedThroughAt: new Date("2026-10-24T09:55:00.000Z"),
      verifiedThroughAt: new Date("2026-10-24T09:58:00.000Z"),
    });
    prismaMock.$transaction
      .mockRejectedValueOnce(prismaError("P2034"))
      .mockImplementationOnce(async (operation: (tx: unknown) => unknown) => operation(prismaMock));
    (cancelOrder as jest.Mock).mockResolvedValue({});

    await expect(runPaymentMaintenance(now)).resolves.toMatchObject({ expired: 1 });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    expect(cancelOrder).toHaveBeenCalledTimes(1);
  });

  it("escalates inconclusive verification without touching stock", async () => {
    prismaMock.payment.findMany.mockResolvedValue([
      { ...payment, status: "VERIFYING", reviewAfter: new Date("2026-10-24T09:59:00.000Z") },
    ]);
    prismaMock.payment.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.paymentReviewCase.upsert.mockResolvedValue({});

    await expect(runPaymentMaintenance(now)).resolves.toMatchObject({ escalated: 1, expired: 0 });
    expect(prismaMock.paymentReviewCase.upsert).toHaveBeenCalled();
    expect(cancelOrder).not.toHaveBeenCalled();
  });
});
