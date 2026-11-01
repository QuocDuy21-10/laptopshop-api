import {
  createConfirmToken,
  createUnsubscribeToken,
  hashConfirmToken,
  parseUnsubscribeToken,
} from "modules/newsletter/newsletter.tokens";

describe("confirm token", () => {
  it("is random, url-safe and stored only as a sha-256 hash", () => {
    const a = createConfirmToken();
    const b = createConfirmToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(hashConfirmToken(a.token));
    expect(a.hash).not.toContain(a.token);
  });
});

describe("unsubscribe token", () => {
  it("is deterministic per id and differs between ids", () => {
    expect(createUnsubscribeToken(7)).toBe(createUnsubscribeToken(7));
    expect(createUnsubscribeToken(7)).not.toBe(createUnsubscribeToken(8));
    expect(createUnsubscribeToken(7)).toMatch(/^7\.[A-Za-z0-9_-]{43}$/);
  });

  it("parses back to the id", () => {
    expect(parseUnsubscribeToken(createUnsubscribeToken(123))).toBe(123);
  });

  it("rejects tampered, malformed and out-of-range tokens", () => {
    const good = createUnsubscribeToken(5);
    const [, mac] = good.split(".");
    expect(parseUnsubscribeToken(`6.${mac}`)).toBeNull();
    expect(parseUnsubscribeToken(`5.${mac.slice(0, -1)}A`)).toBeNull();
    expect(parseUnsubscribeToken("5")).toBeNull();
    expect(parseUnsubscribeToken("abc.def")).toBeNull();
    expect(parseUnsubscribeToken("")).toBeNull();
    expect(parseUnsubscribeToken(`99999999999.${mac}`)).toBeNull();
  });
});
