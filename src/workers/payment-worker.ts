import { prisma } from "config/client";
import { logger } from "lib/logger";
import { startPaymentWorker } from "modules/payments/reconciliation.service";

startPaymentWorker();
logger.info("Payment worker is running");

const shutdown = async (signal: string) => {
  logger.info({ signal }, "payment worker shutting down");
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
