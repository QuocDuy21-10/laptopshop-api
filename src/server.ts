import "./instrument"; // must stay first: Sentry initialises on import
import { RedisStore } from "connect-redis";
import { env } from "config/env";
import { prisma } from "config/client";
import initDatabase from "config/seed";
import { createRedisClient } from "config/redis";
import { createRedisLimitStore } from "middlewares/rate-limit";
import { logger } from "lib/logger";
import { createApp } from "./app";

const main = async () => {
  const redis = createRedisClient(env.REDIS_URL);
  await redis.connect();

  const app = createApp({
    sessionStore: new RedisStore({ client: redis, prefix: "sess:" }),
    limitStores: {
      global: createRedisLimitStore(redis, "rl:global:"),
      auth: createRedisLimitStore(redis, "rl:auth:"),
    },
    readyChecks: [() => prisma.$queryRaw`SELECT 1`, () => redis.ping()],
  });

  await initDatabase();

  const server = app.listen(env.PORT, () => {
    logger.info(`Server is running on port ${env.PORT}`);
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
