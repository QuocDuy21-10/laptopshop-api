import { prisma } from "config/client";
import { env } from "config/env";
import { AppError } from "lib/errors";
import { PaymentAuthority } from "modules/payments/payment-authority";

export type ClaimedCheckpoint = {
  id: number;
  cursor: string | null;
  owner: string;
  authority: PaymentAuthority;
};

const leaseExpiry = (now: Date) => new Date(now.getTime() + env.PAYMENT_RECONCILIATION_LEASE_MS);

export const claimReconciliationLease = async (
  authority: PaymentAuthority,
  owner: string,
  now = new Date(),
): Promise<ClaimedCheckpoint | null> => {
  const checkpoint = await prisma.paymentProviderCheckpoint.upsert({
    where: { provider_mode: { provider: authority.provider, mode: authority.mode } },
    create: { provider: authority.provider, mode: authority.mode, lastStartedAt: now },
    update: {},
  });
  const claimed = await prisma.paymentProviderCheckpoint.updateMany({
    where: {
      id: checkpoint.id,
      OR: [{ leaseOwner: null }, { leaseExpiresAt: { lt: now } }],
    },
    data: { leaseOwner: owner, leaseExpiresAt: leaseExpiry(now), lastStartedAt: now },
  });
  if (claimed.count !== 1) return null;
  const current = await prisma.paymentProviderCheckpoint.findUnique({
    where: { id: checkpoint.id },
  });
  if (!current)
    throw new AppError("Payment checkpoint disappeared", 500, "PAYMENT_CHECKPOINT_NOT_FOUND");
  return { id: current.id, cursor: current.cursor, owner, authority };
};

export const renewReconciliationLease = async (
  checkpointId: number,
  owner: string,
  now = new Date(),
) => {
  const result = await prisma.paymentProviderCheckpoint.updateMany({
    where: { id: checkpointId, leaseOwner: owner },
    data: { leaseExpiresAt: leaseExpiry(now) },
  });
  return result.count === 1;
};

export const completeReconciliationCycle = async (input: {
  checkpointId: number;
  owner: string;
  cursor: string | null;
  verificationBoundary: Date;
  processed: number;
  now?: Date;
}) => {
  const current = await prisma.paymentProviderCheckpoint.findUnique({
    where: { id: input.checkpointId },
    select: { verifiedThroughAt: true },
  });
  const result = await prisma.paymentProviderCheckpoint.updateMany({
    where: { id: input.checkpointId, leaseOwner: input.owner },
    data: {
      cursor: input.cursor,
      previousVerifiedThroughAt: current?.verifiedThroughAt ?? null,
      verifiedThroughAt: input.verificationBoundary,
      lastSucceededAt: input.now ?? new Date(),
      lastDurationMs: input.now
        ? Math.max(0, input.now.getTime() - input.verificationBoundary.getTime())
        : null,
      lastProcessedCount: input.processed,
      consecutiveSuccesses: { increment: 1 },
      consecutiveFailures: 0,
      lastErrorAt: null,
      lastError: null,
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  });
  return result.count === 1;
};

export const failReconciliationCycle = async (input: {
  checkpointId: number;
  owner: string;
  error: string;
  now?: Date;
}) => {
  const result = await prisma.paymentProviderCheckpoint.updateMany({
    where: { id: input.checkpointId, leaseOwner: input.owner },
    data: {
      lastErrorAt: input.now ?? new Date(),
      lastError: input.error.slice(0, 500),
      consecutiveSuccesses: 0,
      consecutiveFailures: { increment: 1 },
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  });
  return result.count === 1;
};
