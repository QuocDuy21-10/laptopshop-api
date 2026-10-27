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
    expect(e.ADVISOR_CANDIDATE_BATCH_SIZE).toBe(200);
    expect(e.ADVISOR_AI_CONCURRENCY_LIMIT).toBe(2);
    expect(e.ADVISOR_AI_CONCURRENCY_LEASE_MS).toBe(15_000);
    expect(e.REVIEW_IMAGES_ENABLED).toBe(false);
    expect(e.REVIEW_IMAGE_S3_ENDPOINT).toBeUndefined();
    expect(e.REVIEW_IMAGE_S3_REGION).toBeUndefined();
    expect(e.REVIEW_IMAGE_S3_BUCKET).toBeUndefined();
    expect(e.REVIEW_IMAGE_S3_FORCE_PATH_STYLE).toBe(false);
    expect(e.REVIEW_IMAGE_URL_TTL_SECONDS).toBe(900);
    expect(e.REVIEW_IMAGE_SYNC_LEASE_MS).toBe(120_000);
    expect(e.REVIEW_IMAGE_SYNC_RETRY_TTL_MS).toBe(3_600_000);
    expect(e.REVIEW_IMAGE_IDEMPOTENCY_RETENTION_MS).toBe(86_400_000);
    expect(e.PRICE_ALERT_INTERVAL_MS).toBe(300_000);
    expect(e.PRICE_ALERT_PRODUCT_BATCH_SIZE).toBe(100);
    expect(e.PRICE_ALERT_ITEM_BATCH_SIZE).toBe(500);
    expect(e.PRICE_ALERT_LOCK_TTL_MS).toBe(240_000);
    expect(e.NOTIFICATION_OUTBOX_ENABLED).toBe(false);
    expect(e.NOTIFICATION_WORKER_ENABLED).toBe(false);
    expect(e.NOTIFICATION_QUEUE_PREFIX).toBe("laptopshop");
    expect(e.OUTBOX_BATCH_SIZE).toBe(100);
    expect(e.OUTBOX_LEASE_MS).toBe(60_000);
    expect(e.DELIVERY_MAX_ATTEMPTS).toBe(5);
    expect(e.FLASH_SALE_PRICE_ALERT_ENABLED).toBe(false);
    expect(e.PRICE_RESOLVER_SHADOW_MODE).toBe(false);
    expect(e.CATALOG_PROMOTION_PRICING_ENABLED).toBe(false);
    expect(e.WEB_PUSH_ENABLED).toBe(false);
    expect(e.VAPID_PUBLIC_KEY).toBeUndefined();
    expect(e.EMAIL_ENABLED).toBe(false);
    expect(e.EMAIL_PROVIDER).toBe("smtp");
    expect(e.SMTP_PORT).toBe(1025);
    expect(e.EMAIL_OTP_KEY_VERSION).toBe("v1");
    expect(e.STOREFRONT_ORIGIN).toBe("http://localhost:3000");
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
      PAYMENT_EVENT_KEY_ID: "payment-key-v1",
      PAYMENT_RECONCILIATION_INTERVAL_MS: "120000",
      PAYMENT_RECONCILIATION_SETTLEMENT_SECONDS: "300",
      PAYMENT_MAX_AUTO_HOLD_MINUTES: "60",
      SEPAY_API_TIMEOUT_MS: "10000",
      PAYMENT_RECONCILIATION_LEASE_MS: "60000",
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
    expect(e.PAYMENT_EVENT_KEY_ID).toBe("payment-key-v1");
    expect(e.PAYMENT_RECONCILIATION_INTERVAL_MS).toBe(120_000);
    expect(e.PAYMENT_RECONCILIATION_SETTLEMENT_SECONDS).toBe(300);
    expect(e.PAYMENT_MAX_AUTO_HOLD_MINUTES).toBe(60);
    expect(e.SEPAY_API_TIMEOUT_MS).toBe(10_000);
    expect(e.PAYMENT_RECONCILIATION_LEASE_MS).toBe(60_000);
  });

  it("rejects non-hex payment encryption keys and missing key ids", () => {
    expect(() =>
      parseEnv({
        ...base,
        PAYMENT_PROVIDER: "sepay",
        PAYMENT_EVENT_ENCRYPTION_KEY: "g".repeat(64),
      }),
    ).toThrow(/PAYMENT_EVENT_ENCRYPTION_KEY/);
    expect(() =>
      parseEnv({
        ...base,
        PAYMENT_PROVIDER: "sepay",
        PAYMENT_EVENT_ENCRYPTION_KEY: "a".repeat(64),
        SEPAY_WEBHOOK_SECRET: "webhook-secret",
        SEPAY_API_TOKEN: "api-token",
        SEPAY_BANK_CODE: "VCB",
        SEPAY_ACCOUNT_NUMBER: "0123456789",
        SEPAY_ACCOUNT_NAME: "LAPTOP SHOP",
      }),
    ).toThrow(/PAYMENT_EVENT_KEY_ID/);
  });

  it("validates bounded payment reconciliation timings", () => {
    expect(() => parseEnv({ ...base, PAYMENT_MAX_AUTO_HOLD_MINUTES: "29" })).toThrow(
      /PAYMENT_MAX_AUTO_HOLD_MINUTES/,
    );
    expect(() => parseEnv({ ...base, PAYMENT_MAX_AUTO_HOLD_MINUTES: "1441" })).toThrow(
      /PAYMENT_MAX_AUTO_HOLD_MINUTES/,
    );
    expect(() => parseEnv({ ...base, PAYMENT_RECONCILIATION_INTERVAL_MS: "59999" })).toThrow(
      /PAYMENT_RECONCILIATION_INTERVAL_MS/,
    );
    expect(() =>
      parseEnv({
        ...base,
        SEPAY_API_TIMEOUT_MS: "10000",
        PAYMENT_RECONCILIATION_LEASE_MS: "10000",
      }),
    ).toThrow(/PAYMENT_RECONCILIATION_LEASE_MS/);
  });

  it("requires all VAPID values when Web Push is enabled", () => {
    expect(() => parseEnv({ ...base, WEB_PUSH_ENABLED: "true" })).toThrow(/VAPID/);
    const e = parseEnv({
      ...base,
      WEB_PUSH_ENABLED: "true",
      VAPID_SUBJECT: "mailto:ops@example.test",
      VAPID_PUBLIC_KEY: "public",
      VAPID_PRIVATE_KEY: "private",
    });
    expect(e.WEB_PUSH_ENABLED).toBe(true);
  });

  it("requires OTP encryption and rejects SMTP Email in production", () => {
    expect(() => parseEnv({ ...base, EMAIL_ENABLED: "true" })).toThrow(/EMAIL_OTP_ENCRYPTION_KEY/);
    expect(() =>
      parseEnv({
        ...base,
        NODE_ENV: "production",
        ADMIN_PASSWORD: "a-long-password-1",
        EMAIL_ENABLED: "true",
        EMAIL_OTP_ENCRYPTION_KEY: "a".repeat(64),
      }),
    ).toThrow(/EMAIL_PROVIDER/);
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

  it("requires review image bucket and region when image storage is enabled", () => {
    expect(() => parseEnv({ ...base, REVIEW_IMAGES_ENABLED: "true" })).toThrow(
      /REVIEW_IMAGE_S3_REGION|REVIEW_IMAGE_S3_BUCKET/,
    );
  });

  it("parses MinIO review image configuration and paired credentials", () => {
    const e = parseEnv({
      ...base,
      REVIEW_IMAGES_ENABLED: "true",
      REVIEW_IMAGE_S3_ENDPOINT: "http://localhost:9000",
      REVIEW_IMAGE_S3_REGION: "us-east-1",
      REVIEW_IMAGE_S3_BUCKET: "laptopshop-review-images",
      REVIEW_IMAGE_S3_ACCESS_KEY_ID: "minio",
      REVIEW_IMAGE_S3_SECRET_ACCESS_KEY: "minio-secret",
      REVIEW_IMAGE_S3_FORCE_PATH_STYLE: "true",
      REVIEW_IMAGE_URL_TTL_SECONDS: "1200",
    });
    expect(e.REVIEW_IMAGES_ENABLED).toBe(true);
    expect(e.REVIEW_IMAGE_S3_ENDPOINT).toBe("http://localhost:9000");
    expect(e.REVIEW_IMAGE_S3_REGION).toBe("us-east-1");
    expect(e.REVIEW_IMAGE_S3_BUCKET).toBe("laptopshop-review-images");
    expect(e.REVIEW_IMAGE_S3_ACCESS_KEY_ID).toBe("minio");
    expect(e.REVIEW_IMAGE_S3_FORCE_PATH_STYLE).toBe(true);
    expect(e.REVIEW_IMAGE_URL_TTL_SECONDS).toBe(1200);
  });

  it.each([
    ["only access key", { REVIEW_IMAGE_S3_ACCESS_KEY_ID: "minio" }],
    ["only secret", { REVIEW_IMAGE_S3_SECRET_ACCESS_KEY: "minio-secret" }],
    ["short ttl", { REVIEW_IMAGE_URL_TTL_SECONDS: "59" }],
    ["long ttl", { REVIEW_IMAGE_URL_TTL_SECONDS: "3601" }],
  ])("rejects invalid review image configuration: %s", (_label, values) => {
    expect(() =>
      parseEnv({
        ...base,
        REVIEW_IMAGES_ENABLED: "true",
        REVIEW_IMAGE_S3_REGION: "us-east-1",
        REVIEW_IMAGE_S3_BUCKET: "laptopshop-review-images",
        ...values,
      }),
    ).toThrow();
  });

  it.each([
    ["lease too short", { REVIEW_IMAGE_SYNC_LEASE_MS: "999" }],
    ["retry ttl too short", { REVIEW_IMAGE_SYNC_RETRY_TTL_MS: "59999" }],
    ["retention too short", { REVIEW_IMAGE_IDEMPOTENCY_RETENTION_MS: "59999" }],
  ])("rejects invalid review image sync configuration: %s", (_label, values) => {
    expect(() => parseEnv({ ...base, ...values })).toThrow();
  });

  it.each([
    ["ADVISOR_AI_TIMEOUT_MS", "999"],
    ["ADVISOR_AI_TIMEOUT_MS", "30001"],
    ["ADVISOR_AI_MAX_OUTPUT_TOKENS", "99"],
    ["ADVISOR_AI_MAX_OUTPUT_TOKENS", "2001"],
    ["ADVISOR_GLOBAL_DAILY_LIMIT", "0"],
    ["ADVISOR_AI_CONCURRENCY_LIMIT", "0"],
    ["ADVISOR_AI_CONCURRENCY_LIMIT", "21"],
    ["ADVISOR_AI_CONCURRENCY_LEASE_MS", "999"],
    ["ADVISOR_AI_CONCURRENCY_LEASE_MS", "60001"],
  ])("rejects invalid advisor configuration %s=%s", (key, value) => {
    expect(() => parseEnv({ ...base, [key]: value })).toThrow();
  });

  it("requires an admission lease to outlive the provider timeout", () => {
    expect(() =>
      parseEnv({
        ...base,
        ADVISOR_AI_TIMEOUT_MS: "11000",
        ADVISOR_AI_CONCURRENCY_LEASE_MS: "12000",
      }),
    ).toThrow(/ADVISOR_AI_CONCURRENCY_LEASE_MS/);
  });

  it.each([
    ["PRICE_ALERT_INTERVAL_MS", "999"],
    ["PRICE_ALERT_INTERVAL_MS", "3600001"],
    ["PRICE_ALERT_PRODUCT_BATCH_SIZE", "0"],
    ["PRICE_ALERT_PRODUCT_BATCH_SIZE", "501"],
    ["PRICE_ALERT_ITEM_BATCH_SIZE", "0"],
    ["PRICE_ALERT_ITEM_BATCH_SIZE", "5001"],
    ["PRICE_ALERT_LOCK_TTL_MS", "9999"],
    ["PRICE_ALERT_LOCK_TTL_MS", "900001"],
  ])("rejects invalid price alert configuration %s=%s", (key, value) => {
    expect(() => parseEnv({ ...base, [key]: value })).toThrow();
  });
});
