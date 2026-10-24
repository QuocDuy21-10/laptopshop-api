import { describe, expect, it, jest } from "@jest/globals";
import type { PriceAlertCheckpointSnapshot } from "modules/price-alerts/price-alert.checkpoint";
import type { LockedPriceAlertSweepResult } from "modules/price-alerts/price-alert.runner";
import { runPriceAlertWorkerIteration } from "../../src/workers/price-alert-worker";

type HeartbeatFn = (
  status: "RUNNING" | "HEALTHY" | "DEGRADED",
  metadata?: Record<string, unknown>,
) => Promise<unknown>;

const sweep = (overrides: Partial<Extract<LockedPriceAlertSweepResult, { kind: "RAN" }>> = {}) => ({
  kind: "RAN" as const,
  sweep: {
    stats: {
      productsScanned: 1,
      itemsEvaluated: 1,
      notificationsCreated: 1,
      duplicatesSkipped: 0,
      invalidStatesSkipped: 0,
      errors: 0,
    },
    lastProductId: 42,
    completed: true,
    stopReason: "COMPLETED" as const,
  },
  ...overrides,
});

const deps = (runSweep: () => Promise<LockedPriceAlertSweepResult>) => ({
  instanceId: "instance-1",
  now: () => new Date("2026-10-24T02:00:00.000Z"),
  runSweep,
  recordHeartbeat: jest.fn<HeartbeatFn>().mockResolvedValue(undefined),
  getCheckpoint: jest.fn<() => Promise<PriceAlertCheckpointSnapshot | null>>().mockResolvedValue({
    checkpointProductId: 42,
    cycleStartedAt: null,
    lastStartedAt: null,
    lastCompletedAt: null,
    lastSucceededAt: null,
    lastDurationMs: null,
    consecutiveFailures: 0,
    lastErrorCode: null,
    lastStats: null,
    updatedAt: new Date("2026-10-24T02:00:00.000Z"),
  }),
});

describe("price alert worker iteration", () => {
  it("records RUNNING then HEALTHY for a clean sweep", async () => {
    const input = deps(async () => sweep());

    await expect(runPriceAlertWorkerIteration(input)).resolves.toMatchObject({ kind: "RAN" });
    expect(input.recordHeartbeat).toHaveBeenNthCalledWith(1, "RUNNING", expect.anything());
    expect(input.recordHeartbeat).toHaveBeenLastCalledWith(
      "HEALTHY",
      expect.objectContaining({ checkpointProductId: 42 }),
    );
  });

  it("keeps lock-held instances healthy and marks lock failures degraded", async () => {
    const skipped = deps(async () => ({ kind: "SKIPPED" as const, reason: "LOCK_HELD" as const }));
    await runPriceAlertWorkerIteration(skipped);
    expect(skipped.recordHeartbeat).toHaveBeenLastCalledWith(
      "HEALTHY",
      expect.objectContaining({ reason: "LOCK_HELD" }),
    );

    const failed = deps(async () => ({
      kind: "FAILED" as const,
      reason: "LOCK_UNAVAILABLE" as const,
    }));
    await runPriceAlertWorkerIteration(failed);
    expect(failed.recordHeartbeat).toHaveBeenLastCalledWith(
      "DEGRADED",
      expect.objectContaining({ reason: "LOCK_UNAVAILABLE" }),
    );
  });

  it("marks a sweep with errors or lost lease as degraded", async () => {
    const input = deps(async () =>
      sweep({
        sweep: {
          ...sweep().sweep,
          completed: false,
          stopReason: "LEASE_LOST",
          stats: { ...sweep().sweep.stats, errors: 1 },
        },
      }),
    );

    await runPriceAlertWorkerIteration(input);
    expect(input.recordHeartbeat).toHaveBeenLastCalledWith(
      "DEGRADED",
      expect.objectContaining({ reason: "LEASE_LOST" }),
    );
  });
});
