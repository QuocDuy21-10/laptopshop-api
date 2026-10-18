import "./instrument"; // must stay first: Sentry initialises on import
import { env } from "config/env";
import { prisma } from "config/client";
import { createRedisClient } from "config/redis";
import { createRedisLimitStore } from "middlewares/rate-limit";
import { logger } from "lib/logger";
import { registerDocs } from "docs/openapi";
import { createApp } from "./app";

const main = async () => {
  const redis = createRedisClient(env.REDIS_URL);
  await redis.connect();

  const app = createApp({
    limitStores: {
      global: createRedisLimitStore(redis, "rl:global:"),
      auth: createRedisLimitStore(redis, "rl:auth:"),
    },
    registerExtras: registerDocs,
    readyChecks: [() => prisma.$queryRaw`SELECT 1`, () => redis.ping()],
  });

  const server = app.listen(env.PORT, () => {
    const base = `http://localhost:${env.PORT}`;
    logger.info(`Server is running on port ${env.PORT}`);
    logger.info(`API:     ${base}/api/v1`);
    if (env.ENABLE_DOCS) logger.info(`Swagger: ${base}/api-docs`);
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down");
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    server.close(async () => {
      await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
      process.exit(0);
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
};

main().catch((err) => {
  logger.error({ err }, "failed to start");
  process.exit(1);
});
