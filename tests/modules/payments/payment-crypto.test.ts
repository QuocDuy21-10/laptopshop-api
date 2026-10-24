import { decryptPayload, encryptPayload } from "modules/payments/payment-crypto";

describe("payment payload encryption", () => {
  it("round-trips a raw provider payload", () => {
    const encrypted = encryptPayload(Buffer.from('{"id":1}'), "a".repeat(64), "payment-key-test");
    expect(decryptPayload(encrypted, "a".repeat(64)).toString()).toBe('{"id":1}');
    expect(encrypted.hash).toHaveLength(64);
    expect(encrypted.keyId).toBe("payment-key-test");
    expect(encrypted.keyId).not.toBe("aaaaaaaa");
  });
});
