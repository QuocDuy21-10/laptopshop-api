import type { RedisClientType } from "redis";
import { prisma } from "config/client";
import { logger } from "lib/logger";
import {
  advancePriceAlertCheckpoint,
  claimPriceAlertCheckpoint,
  completePriceAlertCheckpoint,
  failPriceAlertCheckpoint,
} from "modules/price-alerts/price-alert.checkpoint";
import {
  acquirePriceAlertLock,
  renewPriceAlertLock,
  releasePriceAlertLock,
} from "modules/price-alerts/price-alert.lock";
import {
  runPriceAlertSweep,
  type PriceAlertSweepResult,
  type PriceAlertSweepStats,
} from "modules/price-alerts/price-alert.service";

export type PriceAlertRunnerDeps = {
  redis: RedisClientType;
  client: typeof prisma;
  now: () => Date;
  productBatchSize: number;
  itemBatchSize?: number;
  lockTtlMs: number;
  token: () => string;
  logger: Pick<typeof logger, "info" | "warn" | "error">;
};

const LOCK_KEY = "worker:price-alert:sweep";

export type LockedPriceAlertSweepResult =
  | { kind: "RAN"; sweep: PriceAlertSweepResult }
  | { kind: "SKIPPED"; reason: "LOCK_HELD" }
  | { kind: "FAILED"; reason: "LOCK_UNAVAILABLE" };

const zeroStats = (): PriceAlertSweepStats => ({
  productsScanned: 0,
  itemsEvaluated: 0,
  notificationsCreated: 0,
  duplicatesSkipped: 0,
  invalidStatesSkipped: 0,
  errors: 0,
});

export const runLockedPriceAlertSweep = async (
  deps: PriceAlertRunnerDeps,
): Promise<LockedPriceAlertSweepResult> => {
  const token = deps.token();
  let acquired: boolean;
  try {
    acquired = await acquirePriceAlertLock(deps.redis, LOCK_KEY, token, deps.lockTtlMs);
  } catch (error) {
    deps.logger.error({ error }, "price alert lock unavailable");
    return { kind: "FAILED", reason: "LOCK_UNAVAILABLE" };
  }
  if (!acquired) {
    deps.logger.info({ key: LOCK_KEY }, "price alert sweep already locked");
    return { kind: "SKIPPED", reason: "LOCK_HELD" };
  }

  const heartbeatEveryMs = Math.max(1_000, Math.floor(deps.lockTtlMs / 3));
  let leaseLost = false;
  const heartbeat = setInterval(() => {
    void renewPriceAlertLock(deps.redis, LOCK_KEY, token, deps.lockTtlMs)
      .then((renewed) => {
        if (!renewed) {
          leaseLost = true;
          deps.logger.warn({ key: LOCK_KEY }, "price alert sweep lock lease lost");
        }
      })
      .catch((error) => {
        leaseLost = true;
        deps.logger.error({ error, key: LOCK_KEY }, "price alert sweep lock renewal failed");
      });
  }, heartbeatEveryMs);
  heartbeat.unref();

  const startedAt = Date.now();
  const now = deps.now();
  let checkpointOwner = false;
  try {
    const checkpoint = await claimPriceAlertCheckpoint(deps.client, {
      ownerToken: token,
      now,
    });
    checkpointOwner = true;
    const sweep = await runPriceAlertSweep({
      client: deps.client,
      now,
      productBatchSize: deps.productBatchSize,
      itemBatchSize: deps.itemBatchSize ?? deps.productBatchSize,
      startAfterProductId: checkpoint.checkpointProductId,
      logger: deps.logger,
      shouldContinue: () => !leaseLost,
      onProductBatchComplete: async (lastProductId, stats) => {
        if (leaseLost) return false;
        return advancePriceAlertCheckpoint(deps.client, {
          ownerToken: token,
          lastProductId,
          stats,
        });
      },
    });
    const durationMs = Date.now() - startedAt;
    let effectiveSweep = sweep;
    if (
      !leaseLost &&
      sweep.stopReason !== "LEASE_LOST" &&
      sweep.stopReason !== "CHECKPOINT_REJECTED"
    ) {
      if (sweep.completed) {
        const persisted = await completePriceAlertCheckpoint(deps.client, {
          ownerToken: token,
          now: deps.now(),
          durationMs,
          stats: sweep.stats,
          successful: sweep.stats.errors === 0,
        });
        if (!persisted) {
          effectiveSweep = { ...sweep, completed: false, stopReason: "CHECKPOINT_REJECTED" };
        }
      } else {
        const persisted = await failPriceAlertCheckpoint(deps.client, {
          ownerToken: token,
          now: deps.now(),
          durationMs,
          errorCode: "BATCH_ERROR",
          stats: sweep.stats,
        });
        if (!persisted) {
          effectiveSweep = { ...sweep, completed: false, stopReason: "CHECKPOINT_REJECTED" };
        }
      }
    }
    deps.logger.info(
      { ...effectiveSweep.stats, durationMs, leaseLost, stopReason: effectiveSweep.stopReason },
      "price alert sweep completed",
    );
    return { kind: "RAN", sweep: effectiveSweep };
  } catch (error) {
    if (checkpointOwner && !leaseLost) {
      await failPriceAlertCheckpoint(deps.client, {
        ownerToken: token,
        now: deps.now(),
        durationMs: Date.now() - startedAt,
        errorCode: "SWEEP_FAILED",
        stats: zeroStats(),
      });
    }
    throw error;
  } finally {
    clearInterval(heartbeat);
    try {
      await releasePriceAlertLock(deps.redis, LOCK_KEY, token);
    } catch (error) {
      deps.logger.error({ error }, "price alert lock release failed");
    }
  }
};
