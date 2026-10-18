import { TEST_DATABASE_URL } from "./db-url";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_SECRET = "int-jwt-secret-0123456789";
process.env.REDIS_URL = "redis://localhost:6379";
