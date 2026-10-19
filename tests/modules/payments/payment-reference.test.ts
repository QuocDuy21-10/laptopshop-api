import { createTransferCode } from "modules/payments/payment-reference";

describe("createTransferCode", () => {
  it("creates an uppercase LS-prefixed bank-safe reference", () => {
    const value = createTransferCode(() => 0.123456789);
    expect(value).toMatch(/^LS[A-Z0-9]{12}$/);
  });

  it("uses only the injected random source", () => {
    const value = createTransferCode(() => 0);
    expect(value).toBe("LSAAAAAAAAAAAA");
  });
});
