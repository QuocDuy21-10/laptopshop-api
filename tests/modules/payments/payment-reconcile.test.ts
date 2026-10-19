import { classifyPaymentTransaction } from "modules/payments/payment-reconcile";

const payment = {
  status: "PENDING",
  amount: 1000,
  currency: "VND",
  transferCode: "LSABC12345678",
  accountNumber: "0123456789",
  expiresAt: new Date("2026-10-19T10:00:00.000Z"),
};

const transaction = {
  direction: "IN" as const,
  amount: 1000,
  currency: "VND",
  transferCode: "LSABC12345678",
  accountNumber: "0123456789",
  occurredAt: new Date("2026-10-19T09:59:00.000Z"),
};

describe("classifyPaymentTransaction", () => {
  it("matches an exact inbound transaction", () => {
    expect(classifyPaymentTransaction(payment, transaction)).toEqual({ status: "MATCHED" });
  });

  it.each([
    ["OUTBOUND", { direction: "OUT" }],
    ["AMOUNT_MISMATCH", { amount: 999 }],
    ["UNKNOWN_CODE", { transferCode: "OTHER" }],
    ["WRONG_ACCOUNT", { accountNumber: "999" }],
    ["LATE_PAYMENT", { occurredAt: new Date("2026-10-19T10:01:00.000Z") }],
  ] as const)("requires review for %s", (reason, changes) => {
    expect(classifyPaymentTransaction(payment, { ...transaction, ...changes })).toEqual({
      status: "REVIEW_REQUIRED",
      reason,
    });
  });
});
