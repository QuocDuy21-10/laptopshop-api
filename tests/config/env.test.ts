import { parseEnv } from "config/env";

const base = {
  NODE_ENV: "test",
  DATABASE_URL: "mysql://u:p@localhost:3306/db",
  JWT_SECRET: "x".repeat(16),
};

describe("parseEnv", () => {
  it("applies defaults", () => {
    const e = parseEnv(base);
    expect(e.PORT).toBe(8080);
    expect(e.JWT_ACCESS_TTL).toBe("15m");
    expect(e.REFRESH_TTL_DAYS).toBe(7);
    expect(e.COOKIE_DOMAIN).toBeUndefined();
    expect(e.CORS_ORIGINS).toEqual(["http://localhost:3000"]);
    expect(e.ADMIN_PASSWORD).toBe("123456");
    expect(e.ENABLE_DOCS).toBe(false);
    expect(e.SENTRY_DSN).toBeUndefined();
    expect(e.BANK_TRANSFER_ENABLED).toBe(false);
    expect(e.PAYMENT_PROVIDER).toBe("fake");
    expect(e.PAYMENT_TTL_MINUTES).toBe(15);
    expect(e.PAYMENT_GRACE_SECONDS).toBe(120);
    expect(e.SEPAY_MODE).toBe("test");
    expect(e.ADVISOR_AI_ENABLED).toBe(false);
    expect(e.GROQ_STRUCTURED_OUTPUT_MODE).toBe("json_object");
    expect(e.ADVISOR_AI_TIMEOUT_MS).toBe(10_000);
    expect(e.ADVISOR_AI_MAX_OUTPUT_TOKENS).toBe(500);
    expect(e.ADVISOR_GUEST_DAILY_LIMIT).toBe(5);
    expect(e.ADVISOR_USER_DAILY_LIMIT).toBe(10);
    expect(e.ADVISOR_GLOBAL_DAILY_LIMIT).toBe(30);
  });

  it("parses REFRESH_TTL_DAYS and COOKIE_DOMAIN", () => {
    const e = parseEnv({ ...base, REFRESH_TTL_DAYS: "30", COOKIE_DOMAIN: ".shop.com" });
    expect(e.REFRESH_TTL_DAYS).toBe(30);
    expect(e.COOKIE_DOMAIN).toBe(".shop.com");
  });

  it("splits CORS_ORIGINS and treats empty SENTRY_DSN as unset", () => {
    const e = parseEnv({ ...base, CORS_ORIGINS: "https://a.com, https://b.com", SENTRY_DSN: "" });
    expect(e.CORS_ORIGINS).toEqual(["https://a.com", "https://b.com"]);
    expect(e.SENTRY_DSN).toBeUndefined();
  });

  it("throws when a required var is missing", () => {
    const { JWT_SECRET: _omit, ...rest } = base;
    expect(() => parseEnv(rest)).toThrow(/JWT_SECRET/);
  });

  it("requires a strong ADMIN_PASSWORD in production", () => {
    expect(() => parseEnv({ ...base, NODE_ENV: "production" })).toThrow(/ADMIN_PASSWORD/);
    expect(() => parseEnv({ ...base, NODE_ENV: "production", ADMIN_PASSWORD: "short" })).toThrow(
      /ADMIN_PASSWORD/,
    );
    expect(
      parseEnv({ ...base, NODE_ENV: "production", ADMIN_PASSWORD: "a-long-password-1" })
        .ADMIN_PASSWORD,
    ).toBe("a-long-password-1");
  });

  it("parses payment configuration", () => {
    const e = parseEnv({
      ...base,
      BANK_TRANSFER_ENABLED: "true",
      PAYMENT_PROVIDER: "sepay",
      PAYMENT_TTL_MINUTES: "20",
      PAYMENT_GRACE_SECONDS: "180",
      SEPAY_MODE: "live",
      PAYMENT_EVENT_ENCRYPTION_KEY: "a".repeat(64),
      SEPAY_WEBHOOK_SECRET: "webhook-secret",
      SEPAY_API_TOKEN: "api-token",
      SEPAY_BANK_CODE: "VCB",
      SEPAY_ACCOUNT_NUMBER: "0123456789",
      SEPAY_ACCOUNT_NAME: "LAPTOP SHOP",
    });
    expect(e.BANK_TRANSFER_ENABLED).toBe(true);
    expect(e.PAYMENT_PROVIDER).toBe("sepay");
    expect(e.PAYMENT_TTL_MINUTES).toBe(20);
    expect(e.PAYMENT_GRACE_SECONDS).toBe(180);
    expect(e.SEPAY_MODE).toBe("live");
  });

  it("rejects fake provider in production and missing live secrets", () => {
    expect(() =>
      parseEnv({
        ...base,
        NODE_ENV: "production",
        ADMIN_PASSWORD: "a-long-password-1",
        BANK_TRANSFER_ENABLED: "true",
      }),
    ).toThrow(/PAYMENT_PROVIDER/);
    expect(() =>
      parseEnv({
        ...base,
        NODE_ENV: "production",
        ADMIN_PASSWORD: "a-long-password-1",
        BANK_TRANSFER_ENABLED: "true",
        PAYMENT_PROVIDER: "sepay",
      }),
    ).toThrow(/SEPAY/);
  });

  it("requires Groq credentials only when advisor AI is enabled", () => {
    expect(() => parseEnv({ ...base, ADVISOR_AI_ENABLED: "true" })).toThrow(
      /GROQ_API_KEY|GROQ_MODEL/,
    );
    const e = parseEnv({
      ...base,
      ADVISOR_AI_ENABLED: "true",
      GROQ_API_KEY: "groq-test-key",
      GROQ_MODEL: "openai/gpt-oss-20b",
      GROQ_STRUCTURED_OUTPUT_MODE: "strict",
      ADVISOR_AI_TIMEOUT_MS: "12000",
      ADVISOR_AI_MAX_OUTPUT_TOKENS: "450",
      ADVISOR_GUEST_DAILY_LIMIT: "6",
      ADVISOR_USER_DAILY_LIMIT: "11",
      ADVISOR_GLOBAL_DAILY_LIMIT: "31",
    });
    expect(e.ADVISOR_AI_ENABLED).toBe(true);
    expect(e.GROQ_MODEL).toBe("openai/gpt-oss-20b");
    expect(e.ADVISOR_AI_TIMEOUT_MS).toBe(12_000);
  });

  it.each([
    ["ADVISOR_AI_TIMEOUT_MS", "999"],
    ["ADVISOR_AI_TIMEOUT_MS", "30001"],
    ["ADVISOR_AI_MAX_OUTPUT_TOKENS", "99"],
    ["ADVISOR_AI_MAX_OUTPUT_TOKENS", "2001"],
    ["ADVISOR_GLOBAL_DAILY_LIMIT", "0"],
  ])("rejects invalid advisor configuration %s=%s", (key, value) => {
    expect(() => parseEnv({ ...base, [key]: value })).toThrow();
  });
});
