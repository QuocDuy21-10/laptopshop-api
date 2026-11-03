import path from "path";
import { copyFile, mkdir } from "fs/promises";

import { env } from "config/env";
import { logger } from "lib/logger";
import initDatabase from "config/seed";
import { hashPassword } from "lib/password";
import { prisma } from "config/client";
import { buildDemoDataset } from "scripts/demo-seed/build";
import { assertDemoSeedAllowed } from "scripts/demo-seed/guard";
import { resetDatabase } from "scripts/demo-seed/reset";
import { verifyDemoData } from "scripts/demo-seed/verify";
import { persistDemoDataset } from "scripts/demo-seed/persist";
import { BANNER_IMAGE_DIR } from "modules/home-banners/home-banners.files";
import { refreshCatalogPriceWindows } from "modules/pricing/catalog-price-projection.repository";

const DEMO_SEED = 20261102;

const main = async () => {
  assertDemoSeedAllowed({
    nodeEnv: env.NODE_ENV,
    databaseUrl: env.DATABASE_URL,
    allowRemote: env.DEMO_SEED_ALLOW_REMOTE,
  });
  const now = new Date();
  const tables = await resetDatabase();
  logger.info({ tables }, "seed:demo: database reset");
  await initDatabase();

  const [baseProducts, admin, userRole, lastUser, passwordHash] = await Promise.all([
    prisma.product.findMany({ orderBy: { id: "asc" } }),
    prisma.user.findUniqueOrThrow({ where: { username: "admin@gmail.com" } }),
    prisma.role.findUniqueOrThrow({ where: { name: "USER" } }),
    prisma.user.aggregate({ _max: { id: true } }),
    hashPassword(env.DEMO_USER_PASSWORD),
  ]);
  const dataset = buildDemoDataset({
    seed: DEMO_SEED,
    now,
    baseProducts,
    adminId: admin.id,
    userRoleId: userRole.id,
    firstUserId: (lastUser._max.id ?? 0) + 1,
    passwordHash,
  });

  const bannerDir = path.join("public", BANNER_IMAGE_DIR);
  await mkdir(bannerDir, { recursive: true });
  await Promise.all(
    dataset.bannerImages.map(({ from, to }) =>
      copyFile(path.join("public", "images", "product", from), path.join(bannerDir, to)),
    ),
  );
  await persistDemoDataset(dataset);
  await prisma.$transaction(
    (tx) =>
      refreshCatalogPriceWindows(
        tx,
        [...baseProducts.map((p) => p.id), ...dataset.products.map((p) => p.id)],
        now,
      ),
    { timeout: 60_000 },
  );

  const issues = await verifyDemoData(now);
  if (issues.length) {
    logger.error({ issues }, "seed:demo: verification failed");
    process.exitCode = 1;
    return;
  }
  const counts = Object.fromEntries(
    Object.entries(dataset).map(([table, rows]) => [table, Array.isArray(rows) ? rows.length : 0]),
  );
  logger.info(
    {
      counts,
      admin: "admin@gmail.com (password: ADMIN_PASSWORD)",
      customers: `${dataset.users[0].username} … ${dataset.users[dataset.users.length - 1].username} (password: DEMO_USER_PASSWORD)`,
    },
    "seed:demo: done",
  );
};

main()
  .catch((err) => {
    logger.error({ err }, "seed:demo failed");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
