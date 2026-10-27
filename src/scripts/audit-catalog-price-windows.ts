import { prisma } from "config/client";
import { logger } from "lib/logger";
import { auditCatalogPriceProjection } from "modules/pricing/catalog-price-projection.audit";

if (require.main === module) {
  auditCatalogPriceProjection(prisma, new Date())
    .then((result) => {
      logger.info(result, "catalog price projection audit complete");
      return prisma.$disconnect();
    })
    .catch(async (error) => {
      logger.error({ error }, "catalog price projection audit failed");
      await prisma.$disconnect();
      process.exitCode = 1;
    });
}
