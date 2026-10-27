import { prisma } from "config/client";
import { logger } from "lib/logger";
import { auditCatalogPriceProjection } from "modules/pricing/catalog-price-projection.audit";

export const runCatalogPriceProjectionAudit = async (now = new Date()) => {
  const result = await auditCatalogPriceProjection(prisma, now);
  if (result.issues.length) {
    logger.error(result, "catalog price projection audit found issues");
    process.exitCode = 1;
  } else {
    logger.info(result, "catalog price projection audit complete");
  }
  return result;
};

if (require.main === module) {
  runCatalogPriceProjectionAudit()
    .catch((error) => {
      logger.error({ error }, "catalog price projection audit failed");
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
