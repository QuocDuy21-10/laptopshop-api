import { idempotencyKeyHeader, sha256Canonical } from "lib/idempotency";

describe("idempotency helpers", () => {
  it("accepts trimmed keys from 1 to 64 characters", () => {
    expect(idempotencyKeyHeader.parse("  key-1  ")).toBe("key-1");
    expect(() => idempotencyKeyHeader.parse("")).toThrow();
    expect(() => idempotencyKeyHeader.parse("x".repeat(65))).toThrow();
  });

  it("hashes the canonical tuple deterministically", () => {
    const first = sha256Canonical([1, -2, "CORRECTION", "Mất hàng"]);
    expect(first).toBe(sha256Canonical([1, -2, "CORRECTION", "Mất hàng"]));
    expect(first).not.toBe(sha256Canonical([1, -2, "CORRECTION", "Khác"]));
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });
});
