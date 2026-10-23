export type OutboxEventType = "PRICE_REEVALUATION_REQUESTED" | "NOTIFICATION_DELIVERY_REQUESTED";

export type OutboxEventInput = {
  eventType: OutboxEventType;
  aggregateType: string;
  aggregateId: number;
  dedupeKey: string;
  payload: unknown;
  availableAt?: Date;
};

export type OutboxEventRecord = OutboxEventInput & {
  id: number;
  schemaVersion: number;
  leaseOwner?: string | null;
  leaseExpiresAt?: Date | null;
  publishAttempts?: number;
  publishedAt?: Date | null;
};
