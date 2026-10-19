import { AppError } from "lib/errors";

export const PAYMENT_STATUS = {
  PENDING: "PENDING",
  SUCCEEDED: "SUCCEEDED",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED",
} as const;
export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

export const PAYMENT_EVENT_STATUS = {
  MATCHED: "MATCHED",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
  RESOLVED: "RESOLVED",
} as const;

export const PAYMENT_REVIEW_REASON = {
  UNKNOWN_CODE: "UNKNOWN_CODE",
  AMOUNT_MISMATCH: "AMOUNT_MISMATCH",
  WRONG_ACCOUNT: "WRONG_ACCOUNT",
  OUTBOUND: "OUTBOUND",
  LATE_PAYMENT: "LATE_PAYMENT",
  INVALID_PAYMENT_STATE: "INVALID_PAYMENT_STATE",
} as const;
export type PaymentReviewReason =
  (typeof PAYMENT_REVIEW_REASON)[keyof typeof PAYMENT_REVIEW_REASON];

export const paymentNotPayable = () =>
  new AppError("Payment is no longer payable", 409, "PAYMENT_NOT_PAYABLE");

export const canCompleteBankTransferOrder = (paymentStatus: string, orderStatus: string) =>
  paymentStatus === PAYMENT_STATUS.SUCCEEDED &&
  (orderStatus === "SHIPPING" || orderStatus === "COMPLETED");
