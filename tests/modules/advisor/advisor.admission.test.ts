import { RedisAdvisorAdmission } from "modules/advisor/advisor.admission";

const config = {
  guestLimit: 5,
  userLimit: 10,
  globalLimit: 30,
  concurrencyLimit: 2,
  leaseMs: 15_000,
  keyPrefix: "advisor:test",
};

describe("RedisAdvisorAdmission", () => {
  it("acquires a tokenized lease with quota and concurrency keys", async () => {
    const client = { eval: jest.fn().mockResolvedValue(1) };
    const admission = new RedisAdvisorAdmission(client as never, config);
    const result = await admission.acquire({ kind: "guest", key: "guest-key" });

    expect(result.status).toBe("acquired");
    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining("ZCARD"),
      expect.objectContaining({
        keys: [
          "advisor:test:quota:global",
          "advisor:test:quota:guest:guest-key",
          "advisor:test:concurrency",
        ],
        arguments: ["5", "30", "2", "86400", "15000", expect.any(String)],
      }),
    );
    const lease = result.status === "acquired" ? result.lease : null;
    expect(lease).not.toBeNull();
    client.eval.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    await expect(lease!.release()).resolves.toBe(true);
    expect(client.eval).toHaveBeenLastCalledWith(
      expect.stringContaining("ZREM"),
      expect.objectContaining({ keys: ["advisor:test:concurrency"] }),
    );
  });

  it.each([
    [-1, "global_quota"],
    [0, "requester_quota"],
    [-2, "concurrency"],
  ] as const)("maps Redis result %s to %s", async (value, status) => {
    const client = { eval: jest.fn().mockResolvedValue(value) };
    const admission = new RedisAdvisorAdmission(client as never, config);
    await expect(admission.acquire({ kind: "guest", key: "guest-key" })).resolves.toEqual({
      status,
    });
  });

  it("propagates Redis errors and does not expose a refund API", async () => {
    const client = { eval: jest.fn().mockRejectedValue(new Error("redis down")) };
    const admission = new RedisAdvisorAdmission(client as never, config);
    await expect(admission.acquire({ kind: "user", key: "7" })).rejects.toThrow("redis down");
    expect("refund" in admission).toBe(false);
  });

  it("does not let a late lease release remove another token", async () => {
    const client = { eval: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0) };
    const admission = new RedisAdvisorAdmission(client as never, config);
    const result = await admission.acquire({ kind: "guest", key: "guest-key" });
    if (result.status !== "acquired") throw new Error("expected lease");
    await expect(result.lease.release()).resolves.toBe(false);
  });
});
