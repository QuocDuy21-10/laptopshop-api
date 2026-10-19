import { prisma } from "config/client";
import { logger } from "lib/logger";
import { ingestPaymentTransaction } from "modules/payments/payments.service";
import { paymentProvider } from "modules/payments/payment-provider.factory";

export const reconcilePayments = async () => {
  const provider = paymentProvider();
  if (provider.id === "fake") return 0;
  const now = new Date();
  const checkpoint = await prisma.paymentProviderCheckpoint.upsert({
    where: { provider_mode: { provider: provider.id, mode: "live" } },
    create: { provider: provider.id, mode: "live", lastStartedAt: now },
    update: { lastStartedAt: now },
  });
  let cursor = checkpoint.cursor;
  let count = 0;
  try {
    let hasMore = true;
    while (hasMore) {
      const page = await provider.listTransactions({ cursor, limit: 100 });
      for (const transaction of page.items) {
        await ingestPaymentTransaction(transaction, "RECONCILIATION");
        count += 1;
      }
      hasMore = Boolean(page.cursor);
      cursor = page.cursor;
    }
    await prisma.paymentProviderCheckpoint.update({
      where: { id: checkpoint.id },
      data: { cursor, lastSucceededAt: new Date(), lastErrorAt: null, lastError: null },
    });
    return count;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown reconciliation error";
    await prisma.paymentProviderCheckpoint.update({
      where: { id: checkpoint.id },
      data: { lastErrorAt: new Date(), lastError: message.slice(0, 500) },
    });
    logger.error({ provider: provider.id, error: message }, "payment reconciliation failed");
    throw error;
  }
};

export const startPaymentWorker = () => {
  const runExpiry = async () => {
    try {
      const { expirePayments } = await import("modules/payments/payments.service");
      await expirePayments();
    } catch (error) {
      logger.error({ err: error }, "payment expiry tick failed");
    }
  };
  void runExpiry();
  void reconcilePayments().catch(() => undefined);
  const expiryTimer = setInterval(() => void runExpiry(), 30_000);
  const reconciliationTimer = setInterval(
    () => void reconcilePayments().catch(() => undefined),
    15 * 60_000,
  );
  expiryTimer.unref();
  reconciliationTimer.unref();
  return () => {
    clearInterval(expiryTimer);
    clearInterval(reconciliationTimer);
  };
};
