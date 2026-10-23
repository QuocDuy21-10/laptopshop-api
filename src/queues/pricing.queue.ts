export const PRICING_QUEUE_NAME = "pricing-evaluation-v1";

export type PricingEvaluationJob = {
  outboxEventId: number;
  scopeHash?: string;
  eventVersion?: string;
  productIds?: number[];
};
