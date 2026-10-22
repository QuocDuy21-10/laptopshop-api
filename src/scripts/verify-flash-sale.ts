import { prisma } from "config/client";
import { logger } from "lib/logger";
import { verifyFlashSaleCounters } from "modules/promotions/flash-sale-verifier";

const main = async () => {
  const result = await verifyFlashSaleCounters(prisma);
  if (!result.valid) {
    logger.error(
      { category: "flash_sale_counter_mismatch", ...result },
      "flash sale counters mismatch",
    );
    process.exitCode = 1;
    return;
  }
  logger.info({ category: "flash_sale_counters_verified" }, "flash sale counters verified");
};

main()
  .catch((error) => {
    logger.error({ category: "flash_sale_verify_failed", error }, "flash sale verification failed");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
