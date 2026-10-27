// keep unit tests hermetic: `dotenv/config` in config/env must not pick up a developer's local .env
process.env.DOTENV_CONFIG_PATH = "/nonexistent/.env";
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "mysql://test:test@localhost:3306/test";
process.env.JWT_SECRET = "test-jwt-secret-0123456789";
process.env.REDIS_URL = "redis://localhost:6379";
