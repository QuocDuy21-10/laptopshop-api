jest.mock("config/client", () => ({ prisma: {} }));
jest.mock("modules/price-alerts/price-alert.service", () => ({
  runPriceAlertSweep: jest.fn(),
}));

import { describe, expect, it, jest } from "@jest/globals";
import { runPriceAlertSweep } from "modules/price-alerts/price-alert.service";
import { runLockedPriceAlertSweep } from "modules/price-alerts/price-alert.runner";

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const stats = {
  productsScanned: 1,
  itemsEvaluated: 1,
  notificationsCreated: 1,
  duplicatesSkipped: 0,
  invalidStatesSkipped: 0,
  errors: 0,
};
const runSweepMock = runPriceAlertSweep as unknown as jest.Mock<
  (...args: any[]) => Promise<unknown>
>;

const deps = (redis: Record<string, jest.Mock>) => ({
  redis: redis as never,
  client: {} as never,
  now: () => new Date("2026-10-22T04:00:00.000Z"),
  productBatchSize: 100,
  lockTtlMs: 240_000,
  token: () => "token",
  logger,
});

describe("runLockedPriceAlertSweep", () => {
  it("skips without calling the sweep when the lock is unavailable", async () => {
    const set = jest.fn<() => Promise<"OK" | null>>();
    set.mockResolvedValue(null);
    const redis = { set, eval: jest.fn<() => Promise<number>>() };
    await expect(runLockedPriceAlertSweep(deps(redis))).resolves.toBeNull();
    expect(runPriceAlertSweep).not.toHaveBeenCalled();
  });

  it("runs and releases the lock in finally", async () => {
    const set = jest.fn<() => Promise<"OK" | null>>();
    const evalMock = jest.fn<() => Promise<number>>();
    set.mockResolvedValue("OK");
    evalMock.mockResolvedValue(1);
    const redis = { set, eval: evalMock };
    runSweepMock.mockResolvedValue(stats);

    await expect(runLockedPriceAlertSweep(deps(redis))).resolves.toEqual(stats);
    expect(runSweepMock).toHaveBeenCalledWith({
      client: expect.anything(),
      now: new Date("2026-10-22T04:00:00.000Z"),
      productBatchSize: 100,
    });
    expect(redis.eval).toHaveBeenCalled();
  });

  it("fails closed on Redis errors and logs the error", async () => {
    const set = jest.fn<() => Promise<"OK" | null>>();
    set.mockRejectedValue(new Error("redis down"));
    const redis = { set, eval: jest.fn<() => Promise<number>>() };
    await expect(runLockedPriceAlertSweep(deps(redis))).resolves.toBeNull();
    expect(logger.error).toHaveBeenCalled();
    expect(runPriceAlertSweep).not.toHaveBeenCalled();
  });

  it("releases the lock when the sweep throws", async () => {
    const set = jest.fn<() => Promise<"OK" | null>>();
    const evalMock = jest.fn<() => Promise<number>>();
    set.mockResolvedValue("OK");
    evalMock.mockResolvedValue(1);
    const redis = { set, eval: evalMock };
    runSweepMock.mockRejectedValue(new Error("db down"));

    await expect(runLockedPriceAlertSweep(deps(redis))).rejects.toThrow("db down");
    expect(redis.eval).toHaveBeenCalled();
  });
});
