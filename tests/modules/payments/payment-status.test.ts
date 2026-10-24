import {
  PAYMENT_EVENT_STATUS,
  PAYMENT_REVIEW_REASON,
  PAYMENT_STATUS,
  canCompleteBankTransferOrder,
} from "modules/payments/payment-status";

describe("payment status rules", () => {
  it("exposes the terminal payment states", () => {
    expect(PAYMENT_STATUS).toEqual({
      PENDING: "PENDING",
      VERIFYING: "VERIFYING",
      SUCCEEDED: "SUCCEEDED",
      EXPIRED: "EXPIRED",
      CANCELLED: "CANCELLED",
      REVIEW_REQUIRED: "REVIEW_REQUIRED",
    });
  });

  it.each([
    ["PENDING", "PENDING", false],
    ["SUCCEEDED", "SHIPPING", true],
    ["SUCCEEDED", "SHIPPING", true],
    ["PENDING", "SHIPPING", false],
    ["PENDING", "COMPLETED", false],
  ] as const)("allows bank transfer order %s/%s: %s", (payment, order, expected) => {
    expect(canCompleteBankTransferOrder(payment, order)).toBe(expected);
  });

  it("keeps review reasons stable for admin filters", () => {
    expect(PAYMENT_REVIEW_REASON).toEqual({
      UNKNOWN_CODE: "UNKNOWN_CODE",
      AMOUNT_MISMATCH: "AMOUNT_MISMATCH",
      WRONG_ACCOUNT: "WRONG_ACCOUNT",
      OUTBOUND: "OUTBOUND",
      LATE_PAYMENT: "LATE_PAYMENT",
      INVALID_PAYMENT_STATE: "INVALID_PAYMENT_STATE",
      PROVIDER_MISMATCH: "PROVIDER_MISMATCH",
    });
    expect(PAYMENT_EVENT_STATUS.REVIEW_REQUIRED).toBe("REVIEW_REQUIRED");
  });
});
