import { PaymentReviewReason } from "modules/payments/payment-status";

type PaymentLike = {
  status: string;
  amount: number;
  currency: string;
  transferCode: string;
  accountNumber: string;
  expiresAt: Date;
};

type TransactionLike = {
  direction: "IN" | "OUT";
  amount: number;
  currency: string;
  transferCode: string | null;
  accountNumber: string | null;
  occurredAt: Date;
};

export const classifyPaymentTransaction = (payment: PaymentLike, transaction: TransactionLike) => {
  let reason: PaymentReviewReason | undefined;
  if (transaction.direction !== "IN") reason = "OUTBOUND";
  else if (transaction.transferCode !== payment.transferCode) reason = "UNKNOWN_CODE";
  else if (transaction.accountNumber !== payment.accountNumber) reason = "WRONG_ACCOUNT";
  else if (transaction.amount !== payment.amount || transaction.currency !== payment.currency)
    reason = "AMOUNT_MISMATCH";
  else if (transaction.occurredAt > payment.expiresAt) reason = "LATE_PAYMENT";
  else if (!["PENDING", "VERIFYING", "REVIEW_REQUIRED"].includes(payment.status))
    reason = "INVALID_PAYMENT_STATE";
  return reason ? { status: "REVIEW_REQUIRED" as const, reason } : { status: "MATCHED" as const };
};
