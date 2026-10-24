jest.mock("config/client", () => ({ prisma: {} }));
jest.mock("modules/price-alerts/price-alert.service", () => ({
  runPriceAlertSweep: jest.fn(),
}));
jest.mock("modules/price-alerts/price-alert.checkpoint", () => ({
  claimPriceAlertCheckpoint: jest.fn(),
  advancePriceAlertCheckpoint: jest.fn(),
  completePriceAlertCheckpoint: jest.fn(),
  failPriceAlertCheckpoint: jest.fn(),
}));

import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  advancePriceAlertCheckpoint,
  claimPriceAlertCheckpoint,
  completePriceAlertCheckpoint,
  failPriceAlertCheckpoint,
} from "modules/price-alerts/price-alert.checkpoint";
import {
  runPriceAlertSweep,
  type PriceAlertSweepResult,
} from "modules/price-alerts/price-alert.service";
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
const cleanSweep: PriceAlertSweepResult = {
  stats,
  lastProductId: 42,
  completed: true,
  stopReason: "COMPLETED" as const,
};
const runSweepMock = runPriceAlertSweep as unknown as jest.Mock<
  (...args: any[]) => Promise<unknown>
>;
const claimMock = jest.mocked(claimPriceAlertCheckpoint);
const advanceMock = jest.mocked(advancePriceAlertCheckpoint);
const completeMock = jest.mocked(completePriceAlertCheckpoint);
const failMock = jest.mocked(failPriceAlertCheckpoint);

const deps = (redis: Record<string, jest.Mock>) => ({
  redis: redis as never,
  client: {} as never,
  now: () => new Date("2026-10-22T04:00:00.000Z"),
  productBatchSize: 100,
  itemBatchSize: 50,
  lockTtlMs: 240_000,
  token: () => "token",
  logger,
});

beforeEach(() => {
  jest.clearAllMocks();
  claimMock.mockResolvedValue({
    checkpointProductId: 12,
    cycleStartedAt: null,
    lastStartedAt: null,
    lastCompletedAt: null,
    lastSucceededAt: null,
    lastDurationMs: null,
    consecutiveFailures: 0,
    lastErrorCode: null,
    lastStats: null,
    updatedAt: new Date("2026-10-22T04:00:00.000Z"),
  });
  advanceMock.mockResolvedValue(true);
  completeMock.mockResolvedValue(true);
  failMock.mockResolvedValue(true);
});

afterEach(() => jest.useRealTimers());

describe("runLockedPriceAlertSweep", () => {
  it("reports a held lock without calling the sweep", async () => {
    const set = jest.fn<() => Promise<"OK" | null>>().mockResolvedValue(null);
    const redis = { set, eval: jest.fn<() => Promise<number>>() };

    await expect(runLockedPriceAlertSweep(deps(redis))).resolves.toEqual({
      kind: "SKIPPED",
      reason: "LOCK_HELD",
    });
    expect(runPriceAlertSweep).not.toHaveBeenCalled();
  });

  it("reports Redis lock failures as unavailable", async () => {
    const set = jest.fn<() => Promise<"OK" | null>>().mockRejectedValue(new Error("redis down"));
    const redis = { set, eval: jest.fn<() => Promise<number>>() };

    await expect(runLockedPriceAlertSweep(deps(redis))).resolves.toEqual({
      kind: "FAILED",
      reason: "LOCK_UNAVAILABLE",
    });
    expect(logger.error).toHaveBeenCalled();
    expect(runPriceAlertSweep).not.toHaveBeenCalled();
  });

  it("claims the cursor, advances each page and completes a clean sweep", async () => {
    const set = jest.fn<() => Promise<"OK" | null>>().mockResolvedValue("OK");
    const redis = { set, eval: jest.fn<() => Promise<number>>().mockResolvedValue(1) };
    runSweepMock.mockImplementation(async (input) => {
      expect(input.startAfterProductId).toBe(12);
      expect(input.itemBatchSize).toBe(50);
      await input.onProductBatchComplete(42, stats);
      return cleanSweep;
    });

    await expect(runLockedPriceAlertSweep(deps(redis))).resolves.toEqual({
      kind: "RAN",
      sweep: cleanSweep,
    });
    expect(claimMock).toHaveBeenCalledWith(expect.anything(), {
      ownerToken: "token",
      now: new Date("2026-10-22T04:00:00.000Z"),
    });
    expect(advanceMock).toHaveBeenCalledWith(expect.anything(), {
      ownerToken: "token",
      lastProductId: 42,
      stats,
    });
    expect(completeMock).toHaveBeenCalledWith(expect.anything(), {
      ownerToken: "token",
      now: expect.any(Date),
      durationMs: expect.any(Number),
      stats,
      successful: true,
    });
    expect(redis.eval).toHaveBeenCalled();
  });

  it("marks a completed cycle with candidate errors as unsuccessful", async () => {
    const set = jest.fn<() => Promise<"OK" | null>>().mockResolvedValue("OK");
    const redis = { set, eval: jest.fn<() => Promise<number>>().mockResolvedValue(1) };
    const degradedSweep = {
      ...cleanSweep,
      stats: { ...stats, errors: 1 },
    };
    runSweepMock.mockResolvedValue(degradedSweep);

    await runLockedPriceAlertSweep(deps(redis));

    expect(completeMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ successful: false, stats: degradedSweep.stats }),
    );
  });

  it("renews before TTL and stops accepting pages after lease loss", async () => {
    jest.useFakeTimers();
    const set = jest.fn<() => Promise<"OK" | null>>().mockResolvedValue("OK");
    const evalMock = jest.fn<() => Promise<number>>().mockResolvedValueOnce(0).mockResolvedValue(1);
    const redis = { set, eval: evalMock };
    let resolveSweep!: (result: typeof cleanSweep) => void;
    runSweepMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSweep = resolve;
        }),
    );

    const pending = runLockedPriceAlertSweep(deps(redis));
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(80_000);
    expect(logger.warn).toHaveBeenCalledWith(
      { key: "worker:price-alert:sweep" },
      "price alert sweep lock lease lost",
    );
    resolveSweep({ ...cleanSweep, completed: false, stopReason: "LEASE_LOST" });
    await expect(pending).resolves.toMatchObject({ kind: "RAN" });
    expect(advanceMock).not.toHaveBeenCalled();
  });

  it("fails the checkpoint when the sweep throws and still releases the lock", async () => {
    const set = jest.fn<() => Promise<"OK" | null>>().mockResolvedValue("OK");
    const redis = { set, eval: jest.fn<() => Promise<number>>().mockResolvedValue(1) };
    runSweepMock.mockRejectedValue(new Error("db down"));

    await expect(runLockedPriceAlertSweep(deps(redis))).rejects.toThrow("db down");
    expect(failMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ownerToken: "token", errorCode: "SWEEP_FAILED" }),
    );
    expect(redis.eval).toHaveBeenCalled();
  });
});
