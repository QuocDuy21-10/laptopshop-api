import "./instrument"; // must stay first: Sentry initialises on import
import { env } from "config/env";
import { prisma } from "config/client";
import { createRedisClient } from "config/redis";
import { createRedisLimitStore } from "middlewares/rate-limit";
import { logger } from "lib/logger";
import { registerDocs } from "docs/openapi";
import { PrismaAdvisorRepository } from "modules/advisor/advisor.repository";
import { RedisAdvisorQuota } from "modules/advisor/advisor.quota";
import { createAdvisorService, decorateAdvisorProducts } from "modules/advisor/advisor.service";
import { GroqAdvisorProvider } from "modules/advisor/providers/groq-advisor.provider";
import { createApp } from "./app";

const main = async () => {
  const redis = createRedisClient(env.REDIS_URL);
  await redis.connect();

  const advisor = env.ADVISOR_AI_ENABLED
    ? {
        identitySecret: env.JWT_SECRET,
        service: createAdvisorService({
          repository: new PrismaAdvisorRepository(),
          provider: new GroqAdvisorProvider({
            apiKey: env.GROQ_API_KEY!,
            model: env.GROQ_MODEL!,
            timeoutMs: env.ADVISOR_AI_TIMEOUT_MS,
            maxOutputTokens: env.ADVISOR_AI_MAX_OUTPUT_TOKENS,
            structuredOutputMode: env.GROQ_STRUCTURED_OUTPUT_MODE,
          }),
          quota: new RedisAdvisorQuota(redis, {
            guestLimit: env.ADVISOR_GUEST_DAILY_LIMIT,
            userLimit: env.ADVISOR_USER_DAILY_LIMIT,
            globalLimit: env.ADVISOR_GLOBAL_DAILY_LIMIT,
          }),
          logger,
          model: env.GROQ_MODEL,
          priceProducts: decorateAdvisorProducts,
        }),
      }
    : undefined;

  const app = createApp({
    limitStores: {
      global: createRedisLimitStore(redis, "rl:global:"),
      auth: createRedisLimitStore(redis, "rl:auth:"),
      advisor: createRedisLimitStore(redis, "rl:advisor:"),
      reviewImages: createRedisLimitStore(redis, "rl:review-images:"),
      reviewHelpful: createRedisLimitStore(redis, "rl:review-helpful:"),
      afterSalesImages: createRedisLimitStore(redis, "rl:after-sales-images:"),
    },
    advisor,
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
