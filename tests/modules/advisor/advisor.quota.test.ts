import { RedisAdvisorQuota } from "modules/advisor/advisor.quota";

const config = { guestLimit: 5, userLimit: 10, globalLimit: 30 };

describe("RedisAdvisorQuota", () => {
  it("reserves requester and global windows atomically with a 24-hour TTL", async () => {
    const client = { eval: jest.fn().mockResolvedValue(1) };
    const quota = new RedisAdvisorQuota(client as never, config);
    await expect(quota.tryReserve({ kind: "guest", key: "guest-key" })).resolves.toBe(true);
    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining("KEYS[1]"),
      expect.objectContaining({
        keys: ["advisor:quota:global", "advisor:quota:guest:guest-key"],
        arguments: ["5", "30", "86400"],
      }),
    );
  });

  it("uses the user limit and propagates Redis errors without a refund API", async () => {
    const client = { eval: jest.fn().mockRejectedValue(new Error("redis down")) };
    const quota = new RedisAdvisorQuota(client as never, config);
    await expect(quota.tryReserve({ kind: "user", key: "7" })).rejects.toThrow("redis down");
    expect("refund" in quota).toBe(false);
    expect(client.eval).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ arguments: ["10", "30", "86400"] }),
    );
  });

  it("allows only the fake atomic store's boundary successes under concurrency", async () => {
    let count = 0;
    const client = {
      eval: jest.fn(async () => {
        if (count >= 2) return 0;
        count += 1;
        return 1;
      }),
    };
    const quota = new RedisAdvisorQuota(client as never, config);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => quota.tryReserve({ kind: "guest", key: "same" })),
    );
    expect(results.filter(Boolean)).toHaveLength(2);
  });
});
