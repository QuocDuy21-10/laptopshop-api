export type PaymentAuthority = {
  provider: "fake" | "sepay";
  mode: "test" | "live";
};

export const samePaymentAuthority = (left: PaymentAuthority, right: PaymentAuthority) =>
  left.provider === right.provider && left.mode === right.mode;
