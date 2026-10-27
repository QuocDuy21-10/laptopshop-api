import { prisma } from "config/client";
import { logger } from "lib/logger";
import { refreshCatalogPriceWindows } from "modules/pricing/catalog-price-projection.repository";

export const parseCatalogProjectionCommand = (argv: readonly string[]) => ({
  apply: argv.includes("--apply"),
});

export async function rebuildCatalogPriceWindows(options: { apply: boolean }) {
  const products = await prisma.product.findMany({ select: { id: true }, orderBy: { id: "asc" } });
  let refreshed = 0;
  let windows = 0;
  if (options.apply) {
    for (const product of products) {
      const result = await prisma.$transaction((tx) =>
        refreshCatalogPriceWindows(tx, [product.id], new Date()),
      );
      refreshed += result.productCount;
      windows += result.windowCount;
    }
  }
  const summary = { apply: options.apply, products: products.length, refreshed, windows };
  logger.info(summary, "catalog price projection rebuild complete");
  return summary;
}

if (require.main === module) {
  rebuildCatalogPriceWindows(parseCatalogProjectionCommand(process.argv.slice(2)))
    .then(() => prisma.$disconnect())
    .catch(async (error) => {
      logger.error({ error }, "catalog price projection rebuild failed");
      await prisma.$disconnect();
      process.exitCode = 1;
    });
}
