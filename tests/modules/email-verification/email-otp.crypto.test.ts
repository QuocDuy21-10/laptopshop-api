import {
  createEmailOtp,
  decryptEmailOtp,
  verifyEmailOtp,
} from "modules/email-verification/email-otp.crypto";

describe("email OTP crypto", () => {
  it("creates a six digit hash and encrypted code without storing plaintext", () => {
    const value = createEmailOtp("a".repeat(64), "v1");

    expect(value.code).toMatch(/^\d{6}$/);
    expect(value.otpHash).not.toContain(value.code);
    expect(value.otpCiphertext).not.toContain(value.code);
    expect(decryptEmailOtp(value, "a".repeat(64))).toBe(value.code);
    expect(verifyEmailOtp(value.otpHash, value.code)).toBe(true);
  });

  it("fails closed when the encryption key or authentication tag is wrong", () => {
    const value = createEmailOtp("b".repeat(64), "v1");
    expect(() => decryptEmailOtp(value, "c".repeat(64))).toThrow();
    expect(verifyEmailOtp(value.otpHash, "000000")).toBe(false);
  });
});
