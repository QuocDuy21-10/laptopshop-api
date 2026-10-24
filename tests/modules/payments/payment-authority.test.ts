import { samePaymentAuthority, type PaymentAuthority } from "modules/payments/payment-authority";

describe("payment authority", () => {
  it("treats provider mode as part of payment identity", () => {
    const testAuthority: PaymentAuthority = { provider: "sepay", mode: "test" };
    const liveAuthority: PaymentAuthority = { provider: "sepay", mode: "live" };

    expect(samePaymentAuthority(testAuthority, liveAuthority)).toBe(false);
    expect(samePaymentAuthority(testAuthority, { ...testAuthority })).toBe(true);
  });
});
