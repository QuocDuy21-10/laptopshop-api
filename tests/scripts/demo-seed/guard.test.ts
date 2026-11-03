import { parseEnv } from "config/env";
import { assertDemoSeedAllowed } from "scripts/demo-seed/guard";

const local = "mysql://root:secret@localhost:3306/laptopshop";

describe("assertDemoSeedAllowed", () => {
  it("allows local and docker compose hosts", () => {
    for (const url of [local, "mysql://u:p@127.0.0.1:3306/db", "mysql://u:p@mysql:3306/db"])
      expect(() =>
        assertDemoSeedAllowed({ nodeEnv: "development", databaseUrl: url, allowRemote: false }),
      ).not.toThrow();
  });

  it("refuses production even when remote hosts are allowed", () => {
    expect(() =>
      assertDemoSeedAllowed({ nodeEnv: "production", databaseUrl: local, allowRemote: true }),
    ).toThrow(/production/);
  });

  it("refuses a remote host unless explicitly allowed", () => {
    const remote = "mysql://u:p@db.example.com:3306/shop";
    expect(() =>
      assertDemoSeedAllowed({ nodeEnv: "development", databaseUrl: remote, allowRemote: false }),
    ).toThrow(/db\.example\.com/);
    expect(() =>
      assertDemoSeedAllowed({ nodeEnv: "development", databaseUrl: remote, allowRemote: true }),
    ).not.toThrow();
  });
});

describe("demo seed env", () => {
  it("defaults the demo flags", () => {
    const env = parseEnv({ DATABASE_URL: local, JWT_SECRET: "test-jwt-secret-0123456789" });
    expect(env.DEMO_SEED_ALLOW_REMOTE).toBe(false);
    expect(env.DEMO_USER_PASSWORD).toBe("Demo@123456");
  });

  it("parses the remote override", () => {
    const env = parseEnv({
      DATABASE_URL: local,
      JWT_SECRET: "test-jwt-secret-0123456789",
      DEMO_SEED_ALLOW_REMOTE: "true",
    });
    expect(env.DEMO_SEED_ALLOW_REMOTE).toBe(true);
  });
});
