import crypto from "node:crypto";
import { prisma } from "config/client";
import { env } from "config/env";
import { AppError } from "lib/errors";
import { logger } from "lib/logger";
import {
  claimReconciliationLease,
  completeReconciliationCycle,
  failReconciliationCycle,
  renewReconciliationLease,
} from "modules/payments/payment-checkpoint.service";
import { ingestPaymentTransaction } from "modules/payments/payment-ingestion.service";
import { paymentProvider } from "modules/payments/payment-provider.factory";

let reconciliationInFlight: Promise<{ processed: number; skipped: boolean }> | null = null;

const runReconciliation = async (now: Date) => {
  const provider = paymentProvider();
  if (provider.id === "fake") return { processed: 0, skipped: true };
  const owner = crypto.randomUUID();
  const checkpoint = await claimReconciliationLease(provider.authority, owner, now);
  if (!checkpoint) return { processed: 0, skipped: true };
  let cursor = checkpoint.cursor;
  let count = 0;
  try {
    let hasMore = true;
    while (hasMore) {
      const page = await provider.listTransactions({ cursor, limit: 100 });
      if (page.hasMore && (!page.cursor || page.cursor === cursor))
        throw new AppError(
          "Payment reconciliation cursor stalled",
          502,
          "PAYMENT_RECONCILIATION_CURSOR_STALLED",
        );
      for (const transaction of page.items) {
        await ingestPaymentTransaction(provider.authority, transaction, "RECONCILIATION");
        count += 1;
      }
      hasMore = page.hasMore;
      if (page.cursor) cursor = page.cursor;
      if (hasMore && !(await renewReconciliationLease(checkpoint.id, owner, new Date())))
        throw new AppError(
          "Payment reconciliation lease lost",
          409,
          "PAYMENT_RECONCILIATION_LEASE_LOST",
        );
    }
    if (
      !(await completeReconciliationCycle({
        checkpointId: checkpoint.id,
        owner,
        cursor,
        verificationBoundary: now,
        processed: count,
        now: new Date(),
      }))
    )
      throw new AppError(
        "Payment reconciliation lease lost",
        409,
        "PAYMENT_RECONCILIATION_LEASE_LOST",
      );
    return { processed: count, skipped: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown reconciliation error";
    await failReconciliationCycle({ checkpointId: checkpoint.id, owner, error: message });
    logger.error({ provider: provider.id, error: message }, "payment reconciliation failed");
    throw error;
  }
};

export const reconcilePayments = async (now = new Date()) => {
  if (reconciliationInFlight) return { processed: 0, skipped: true };
  reconciliationInFlight = runReconciliation(now);
  try {
    return await reconciliationInFlight;
  } finally {
    reconciliationInFlight = null;
  }
};

export const purgeEncryptedPaymentPayloads = async (now = new Date()) => {
  const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  return prisma.paymentWebhookEvent.updateMany({
    where: { receivedAt: { lt: cutoff }, rawPayload: { not: null } },
    data: { rawPayload: null, rawPayloadIv: null, rawPayloadTag: null, encryptionKeyId: null },
  });
};

export const startPaymentWorker = () => {
  const runMaintenance = async () => {
    try {
      const { runPaymentMaintenance } =
        await import("modules/payments/payment-maintenance.service");
      await runPaymentMaintenance();
    } catch (error) {
      logger.error({ err: error }, "payment maintenance tick failed");
    }
  };
  void runMaintenance();
  void reconcilePayments().catch(() => undefined);
  void purgeEncryptedPaymentPayloads().catch((error) =>
    logger.error({ err: error }, "payment payload purge failed"),
  );
  const expiryTimer = setInterval(() => void runMaintenance(), 30_000);
  const reconciliationTimer = setInterval(
    () => void reconcilePayments().catch(() => undefined),
    env.PAYMENT_RECONCILIATION_INTERVAL_MS,
  );
  const purgeTimer = setInterval(
    () =>
      void purgeEncryptedPaymentPayloads().catch((error) =>
        logger.error({ err: error }, "payment payload purge failed"),
      ),
    24 * 60 * 60_000,
  );
  expiryTimer.unref();
  reconciliationTimer.unref();
  purgeTimer.unref();
  return () => {
    clearInterval(expiryTimer);
    clearInterval(reconciliationTimer);
    clearInterval(purgeTimer);
  };
};
