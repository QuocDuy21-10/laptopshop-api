import { randomUUID } from "crypto";
import { prisma } from "config/client";
import { env } from "config/env";
import { createRedisClient } from "config/redis";
import { logger } from "lib/logger";
import { runLockedPriceAlertSweep } from "modules/price-alerts/price-alert.runner";

const main = async () => {
  const redis = createRedisClient(env.REDIS_URL);
  await redis.connect();
  try {
    await runLockedPriceAlertSweep({
      redis,
      client: prisma,
      now: () => new Date(),
      productBatchSize: env.PRICE_ALERT_PRODUCT_BATCH_SIZE,
      lockTtlMs: env.PRICE_ALERT_LOCK_TTL_MS,
      token: randomUUID,
      logger,
    });
  } finally {
    await Promise.allSettled([redis.quit(), prisma.$disconnect()]);
  }
};

main().catch((error) => {
  logger.error({ error }, "price alert sweep failed");
  process.exit(1);
});
