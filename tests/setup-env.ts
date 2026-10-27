process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "mysql://test:test@localhost:3306/test";
process.env.JWT_SECRET = "test-jwt-secret-0123456789";
process.env.REDIS_URL = "redis://localhost:6379";
// Unit tests must not inherit feature flags from a developer's .env file.
process.env.BANK_TRANSFER_ENABLED = "false";
process.env.PAYMENT_PROVIDER = "fake";
process.env.WEB_PUSH_ENABLED = "false";
process.env.VAPID_SUBJECT = "";
process.env.VAPID_PUBLIC_KEY = "";
process.env.VAPID_PRIVATE_KEY = "";
process.env.EMAIL_ENABLED = "false";
process.env.CATALOG_PROMOTION_PRICING_ENABLED = "false";
