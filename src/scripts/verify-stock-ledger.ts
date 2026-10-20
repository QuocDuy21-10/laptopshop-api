import { prisma } from "config/client";
import { logger } from "lib/logger";
import { findLedgerMismatches } from "modules/inventory/inventory.reconciliation";

const main = async () => {
  const mismatches = await findLedgerMismatches();
  if (mismatches.length) {
    logger.error(
      { category: "ledger_mismatch", count: mismatches.length, mismatches },
      "stock ledger mismatch",
    );
    process.exitCode = 1;
    return;
  }
  logger.info({ category: "ledger_verified" }, "stock ledger verified");
};

main()
  .catch((error) => {
    logger.error({ category: "ledger_verify_failed", error }, "stock ledger verification failed");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
