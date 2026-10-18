import { parseEnv } from "config/env";

const base = {
  NODE_ENV: "test",
  DATABASE_URL: "mysql://u:p@localhost:3306/db",
  JWT_SECRET: "x".repeat(16),
  SESSION_SECRET: "y".repeat(16),
};

describe("parseEnv", () => {
  it("applies defaults", () => {
    const e = parseEnv(base);
    expect(e.PORT).toBe(8080);
    expect(e.JWT_EXPIRES_IN).toBe("1d");
    expect(e.CORS_ORIGINS).toEqual(["http://localhost:5173"]);
    expect(e.ADMIN_PASSWORD).toBe("123456");
    expect(e.ENABLE_DOCS).toBe(false);
    expect(e.SENTRY_DSN).toBeUndefined();
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
});
