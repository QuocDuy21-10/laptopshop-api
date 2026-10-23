import type { RedisClientType } from "redis";
import { prisma } from "config/client";
import { logger } from "lib/logger";
import {
  acquirePriceAlertLock,
  renewPriceAlertLock,
  releasePriceAlertLock,
} from "modules/price-alerts/price-alert.lock";
import {
  runPriceAlertSweep,
  type PriceAlertSweepStats,
} from "modules/price-alerts/price-alert.service";

export type PriceAlertRunnerDeps = {
  redis: RedisClientType;
  client: typeof prisma;
  now: () => Date;
  productBatchSize: number;
  lockTtlMs: number;
  token: () => string;
  logger: Pick<typeof logger, "info" | "warn" | "error">;
};

const LOCK_KEY = "worker:price-alert:sweep";

export const runLockedPriceAlertSweep = async (
  deps: PriceAlertRunnerDeps,
): Promise<PriceAlertSweepStats | null> => {
  const token = deps.token();
  let acquired: boolean;
  try {
    acquired = await acquirePriceAlertLock(deps.redis, LOCK_KEY, token, deps.lockTtlMs);
  } catch (error) {
    deps.logger.error({ error }, "price alert lock unavailable");
    return null;
  }
  if (!acquired) {
    deps.logger.info({ key: LOCK_KEY }, "price alert sweep already locked");
    return null;
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

  try {
    const startedAt = Date.now();
    const stats = await runPriceAlertSweep({
      client: deps.client,
      now: deps.now(),
      productBatchSize: deps.productBatchSize,
      logger: deps.logger,
    });
    deps.logger.info(
      { ...stats, durationMs: Date.now() - startedAt, leaseLost },
      "price alert sweep completed",
    );
    return stats;
  } finally {
    clearInterval(heartbeat);
    try {
      await releasePriceAlertLock(deps.redis, LOCK_KEY, token);
    } catch (error) {
      deps.logger.error({ error }, "price alert lock release failed");
    }
  }
};
