import {
  claimOutboxBatch,
  markOutboxFailed,
  markOutboxPublished,
} from "modules/outbox/outbox.repository";
import type { OutboxEventRecord } from "modules/outbox/outbox.types";

type QueueLike = {
  add: (
    name: string,
    data: Record<string, unknown>,
    options: { jobId: string },
  ) => Promise<unknown>;
};

type DispatcherDeps = {
  claim: () => Promise<OutboxEventRecord[]>;
  queueFor: (eventType: OutboxEventRecord["eventType"]) => QueueLike;
  markPublished: (id: number, owner: string) => Promise<void>;
  markFailed: (id: number, owner: string, error: unknown) => Promise<void>;
  now: Date;
  leaseOwner: string;
};

const jobIdFor = (event: OutboxEventRecord) =>
  event.eventType === "NOTIFICATION_DELIVERY_REQUESTED"
    ? "notification-delivery-" + event.aggregateId
    : "pricing-evaluation-" +
      String(
        (event.payload && typeof event.payload === "object"
          ? (event.payload as Record<string, unknown>).scopeHash
          : undefined) ?? event.aggregateId,
      ) +
      "-" +
      String(
        (event.payload && typeof event.payload === "object"
          ? (event.payload as Record<string, unknown>).eventVersion
          : undefined) ?? event.id,
      );

export const dispatchOutboxBatch = async (deps: DispatcherDeps) => {
  const events = await deps.claim();
  let published = 0;
  let failed = 0;
  for (const event of events) {
    try {
      await deps.queueFor(event.eventType).add(
        event.eventType,
        {
          ...(event.payload && typeof event.payload === "object" ? event.payload : {}),
          outboxEventId: event.id,
        } as Record<string, unknown>,
        { jobId: jobIdFor(event) },
      );
      await deps.markPublished(event.id, deps.leaseOwner);
      published += 1;
    } catch (error) {
      failed += 1;
      await deps.markFailed(event.id, deps.leaseOwner, error);
    }
  }
  return { claimed: events.length, published, failed };
};

export { claimOutboxBatch, markOutboxFailed, markOutboxPublished };
