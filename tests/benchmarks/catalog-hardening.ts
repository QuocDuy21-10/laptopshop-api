import { performance } from "node:perf_hooks";
import type { PrismaClient, Prisma } from "@prisma/client";
import { logger } from "lib/logger";
import { listProducts } from "modules/products/products.service";
import { getProductFacets } from "modules/products/products.facets.service";
import type { ListProductsQuery, ProductFilterQuery } from "modules/products/products.schema";

export type CatalogBenchmarkMode = "baseline" | "hardened";
export type CatalogBenchmarkSize = 10_000 | 50_000;
export type CatalogBenchmarkArgs = {
  size: CatalogBenchmarkSize;
  mode: CatalogBenchmarkMode;
  run: boolean;
};

const parseValue = (argv: readonly string[], key: string) =>
  argv.find((value) => value.startsWith(`--${key}=`))?.slice(key.length + 3);

export const parseCatalogBenchmarkArgs = (argv: readonly string[]): CatalogBenchmarkArgs => {
  const sizeValue = parseValue(argv, "size");
  const mode = parseValue(argv, "mode") as CatalogBenchmarkMode | undefined;
  const size = Number(sizeValue);
  if (size !== 10_000 && size !== 50_000) {
    throw new Error("size must be 10000 or 50000");
  }
  if (mode !== "baseline" && mode !== "hardened") {
    throw new Error("mode must be baseline or hardened");
  }
  return { size, mode, run: argv.includes("--run") };
};

export const assertBenchmarkDatabase = (databaseUrl: string): void => {
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "");
  if (!databaseName.endsWith("_test")) {
    throw new Error("database name must end in _test");
  }
};

type BenchmarkProfile = {
  name: string;
  list: ListProductsQuery;
  facets: ProductFilterQuery;
};

const emptyFacetQuery = (): ProductFilterQuery => ({
  factory: [],
  target: [],
  price: [],
  cpuBrand: [],
  gpuBrand: [],
  gpuType: [],
  ramGb: [],
  storageGb: [],
  screenSize: [],
  resolutionTier: [],
  panelType: [],
  minRefreshHz: undefined,
  minBatteryWh: undefined,
  maxWeightGrams: undefined,
  minWarrantyMonths: undefined,
  minRating: undefined,
  inStock: undefined,
  q: undefined,
});

const profiles = (): BenchmarkProfile[] => {
  const base = emptyFacetQuery();
  const list = (
    facets: ProductFilterQuery,
    sort: ListProductsQuery["sort"] = undefined,
  ): ListProductsQuery => ({
    ...facets,
    page: 1,
    pageSize: 12,
    sort,
  });
  return [
    { name: "default", list: list(base), facets: base },
    {
      name: "price-sort",
      list: list({ ...base, price: ["10-15m"] }, "price_asc"),
      facets: { ...base, price: ["10-15m"] },
    },
    {
      name: "combined-filters",
      list: list({
        ...base,
        cpuBrand: ["INTEL"],
        ramGb: [16, 32],
        minRefreshHz: 144,
        inStock: true,
      }),
      facets: { ...base, cpuBrand: ["INTEL"], ramGb: [16, 32], minRefreshHz: 144, inStock: true },
    },
    {
      name: "rating-price",
      list: list({ ...base, price: ["15-20m"], minRating: 4 }, "rating_desc"),
      facets: { ...base, price: ["15-20m"], minRating: 4 },
    },
    {
      name: "all-facets",
      list: list({ ...base, gpuType: ["DEDICATED"], panelType: ["IPS"], maxWeightGrams: 2000 }),
      facets: { ...base, gpuType: ["DEDICATED"], panelType: ["IPS"], maxWeightGrams: 2000 },
    },
    {
      name: "search-facets",
      list: list({ ...base, q: "benchmark", cpuBrand: ["AMD"] }),
      facets: { ...base, q: "benchmark", cpuBrand: ["AMD"] },
    },
  ];
};

const seedProducts = async (prisma: PrismaClient, size: CatalogBenchmarkSize) => {
  const prefix = `catalog-benchmark-${size}-`;
  await prisma.product.deleteMany({ where: { name: { startsWith: prefix } } });
  const rows: Prisma.ProductCreateManyInput[] = Array.from({ length: size }, (_, index) => ({
    name: `${prefix}${index}`,
    price: 8_000_000 + (index % 15) * 1_000_000,
    quantity: index % 7 === 0 ? 0 : 5,
    isActive: index % 17 !== 0,
    cpuBrand: index % 2 === 0 ? "INTEL" : "AMD",
    gpuBrand: index % 3 === 0 ? "NVIDIA" : "AMD",
    gpuType: index % 3 === 0 ? "DEDICATED" : "INTEGRATED",
    ramGb: [8, 16, 32, 64][index % 4],
    storageGb: [256, 512, 1024][index % 3],
    screenSizeInch: index % 2 === 0 ? 15.6 : 14,
    resolutionTier: index % 4 === 0 ? "QHD" : "FHD",
    panelType: index % 5 === 0 ? "OLED" : "IPS",
    refreshRateHz: index % 2 === 0 ? 144 : 60,
    batteryWh: 50,
    weightGrams: index % 2 === 0 ? 1900 : 2300,
    warrantyMonths: 24,
  }));
  for (let offset = 0; offset < rows.length; offset += 1_000) {
    await prisma.product.createMany({ data: rows.slice(offset, offset + 1_000) });
  }
  return prefix;
};

export async function runCatalogBenchmark(
  prisma: PrismaClient,
  args: CatalogBenchmarkArgs,
): Promise<void> {
  if (!args.run) {
    logger.info({ args }, "catalog benchmark is dry-run; pass --run to mutate the test database");
    return;
  }
  const prefix = await seedProducts(prisma, args.size);
  const samples: Array<{ profile: string; listMs: number; facetsMs: number }> = [];
  for (const profile of profiles()) {
    for (let iteration = 0; iteration < 35; iteration += 1) {
      const listStart = performance.now();
      await listProducts(profile.list);
      const listMs = performance.now() - listStart;
      const facetsStart = performance.now();
      await getProductFacets(profile.facets);
      const facetsMs = performance.now() - facetsStart;
      if (iteration >= 5) samples.push({ profile: profile.name, listMs, facetsMs });
    }
  }
  logger.info(
    { mode: args.mode, size: args.size, prefix, samples: samples.length },
    "catalog benchmark complete",
  );
}

if (require.main === module) {
  void (async () => {
    const args = parseCatalogBenchmarkArgs(process.argv.slice(2));
    const { env } = await import("config/env");
    assertBenchmarkDatabase(env.DATABASE_URL);
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      await runCatalogBenchmark(prisma, args);
    } finally {
      await prisma.$disconnect();
    }
  })().catch((error) => {
    logger.error({ error }, "catalog benchmark failed");
    process.exitCode = 1;
  });
}
