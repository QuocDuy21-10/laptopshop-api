import type { OutboxEventInput, OutboxEventRecord } from "modules/outbox/outbox.types";

type OutboxEventDelegate = {
  outboxEvent: {
    create: (args: unknown) => Promise<unknown>;
    findMany: (args: unknown) => Promise<OutboxEventRecord[]>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
};

type OutboxTransaction = {
  outboxEvent: Pick<OutboxEventDelegate["outboxEvent"], "findMany" | "updateMany">;
};

export const createOutboxEvent = async (
  tx: { outboxEvent: Pick<OutboxEventDelegate["outboxEvent"], "create"> },
  input: OutboxEventInput,
) =>
  tx.outboxEvent.create({
    data: {
      eventType: input.eventType,
      schemaVersion: 1,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      dedupeKey: input.dedupeKey,
      payload: input.payload,
      ...(input.availableAt ? { availableAt: input.availableAt } : {}),
    },
  });

export type ClaimOutboxBatchInput = {
  now: Date;
  leaseOwner: string;
  leaseMs: number;
  limit: number;
};

export const claimOutboxBatch = async (
  client: unknown,
  input: ClaimOutboxBatchInput,
): Promise<OutboxEventRecord[]> => {
  const transactionClient = client as {
    $transaction: <T>(callback: (tx: OutboxTransaction) => Promise<T>) => Promise<T>;
  };
  return transactionClient.$transaction(async (tx) => {
    const candidates = await tx.outboxEvent.findMany({
      where: {
        publishedAt: null,
        availableAt: { lte: input.now },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: input.now } }],
      },
      orderBy: { id: "asc" },
      take: input.limit,
    });
    const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs);
    const claimed: OutboxEventRecord[] = [];
    for (const candidate of candidates) {
      const result = await tx.outboxEvent.updateMany({
        where: {
          id: candidate.id,
          publishedAt: null,
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: input.now } }],
        },
        data: { leaseOwner: input.leaseOwner, leaseExpiresAt },
      });
      if (result.count === 1) {
        claimed.push({ ...candidate, leaseOwner: input.leaseOwner, leaseExpiresAt });
      }
    }
    return claimed;
  });
};

export const markOutboxPublished = async (
  client: { outboxEvent: Pick<OutboxEventDelegate["outboxEvent"], "updateMany"> },
  id: number,
  leaseOwner: string,
  now = new Date(),
) => {
  await client.outboxEvent.updateMany({
    where: { id, leaseOwner, publishedAt: null },
    data: { publishedAt: now, leaseOwner: null, leaseExpiresAt: null },
  });
};

export const markOutboxFailed = async (
  client: { outboxEvent: Pick<OutboxEventDelegate["outboxEvent"], "updateMany"> },
  id: number,
  leaseOwner: string,
  error: unknown,
) => {
  const normalizedErrorCode =
    error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : "OUTBOX_PUBLISH_FAILED";
  await client.outboxEvent.updateMany({
    where: { id, leaseOwner },
    data: {
      publishAttempts: { increment: 1 },
      lastErrorCode: normalizedErrorCode,
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  });
};
