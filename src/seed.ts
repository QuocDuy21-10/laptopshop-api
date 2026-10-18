import { prisma } from "config/client";
import initDatabase from "config/seed";
import { logger } from "lib/logger";

initDatabase()
  .then(() => logger.info("seed: done"))
  .catch((err) => {
    logger.error({ err }, "seed failed");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
