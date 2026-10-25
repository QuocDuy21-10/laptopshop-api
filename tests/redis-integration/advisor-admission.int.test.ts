import { randomUUID } from "node:crypto";
import { env } from "config/env";
import { createRedisClient } from "config/redis";
import { RedisAdvisorAdmission } from "modules/advisor/advisor.admission";

const client = createRedisClient(env.REDIS_URL);
const prefix = `advisor:test:${randomUUID()}`;
const config = {
  guestLimit: 100,
  userLimit: 100,
  globalLimit: 100,
  concurrencyLimit: 2,
  leaseMs: 1_000,
  keyPrefix: prefix,
};

beforeAll(() => client.connect());
afterAll(async () => {
  const keys = await client.keys(`${prefix}:*`);
  if (keys.length) await client.del(keys);
  await client.quit();
});

describe("Redis advisor admission", () => {
  it("never admits more concurrent leases than the configured limit", async () => {
    const admission = new RedisAdvisorAdmission(client, config);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => admission.acquire({ kind: "guest", key: randomUUID() })),
    );
    const acquired = results.filter((result) => result.status === "acquired");
    expect(acquired).toHaveLength(2);
    await Promise.all(
      acquired.map((result) => (result.status === "acquired" ? result.lease.release() : false)),
    );
  });

  it("does not burn daily quota when concurrency rejects a request", async () => {
    const admission = new RedisAdvisorAdmission(client, { ...config, concurrencyLimit: 1 });
    const requester = { kind: "guest" as const, key: "same-requester" };
    const globalBefore = Number((await client.get(`${prefix}:quota:global`)) ?? 0);
    const first = await admission.acquire(requester);
    const second = await admission.acquire(requester);
    expect(first.status).toBe("acquired");
    expect(second).toEqual({ status: "concurrency" });
    expect(await client.get(`${prefix}:quota:guest:same-requester`)).toBe("1");
    expect(await client.get(`${prefix}:quota:global`)).toBe(String(globalBefore + 1));
    if (first.status === "acquired") await first.lease.release();
  });

  it("reclaims an expired lease without allowing a late release to remove its replacement", async () => {
    const admission = new RedisAdvisorAdmission(client, { ...config, leaseMs: 100 });
    const first = await admission.acquire({ kind: "guest", key: "lease-a" });
    expect(first.status).toBe("acquired");
    await new Promise((resolve) => setTimeout(resolve, 150));
    const second = await admission.acquire({ kind: "guest", key: "lease-b" });
    expect(second.status).toBe("acquired");
    if (first.status === "acquired") await expect(first.lease.release()).resolves.toBe(false);
    if (second.status === "acquired") await expect(second.lease.release()).resolves.toBe(true);
  });
});
