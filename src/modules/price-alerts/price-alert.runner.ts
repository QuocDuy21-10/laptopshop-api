import type { RedisClientType } from "redis";
import { prisma } from "config/client";
import { logger } from "lib/logger";
import {
  acquirePriceAlertLock,
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

  try {
    const stats = await runPriceAlertSweep({
      client: deps.client,
      now: deps.now(),
      productBatchSize: deps.productBatchSize,
    });
    deps.logger.info(stats, "price alert sweep completed");
    return stats;
  } finally {
    try {
      await releasePriceAlertLock(deps.redis, LOCK_KEY, token);
    } catch (error) {
      deps.logger.error({ error }, "price alert lock release failed");
    }
  }
};
