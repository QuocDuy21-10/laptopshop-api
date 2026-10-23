import { createHash } from "node:crypto";
import { createOutboxEvent } from "modules/outbox/outbox.repository";

export type PricingReevaluationInput = {
  productIds: number[];
  eventVersion: string;
  availableAt?: Date;
};

const scopeHash = (productIds: number[]) =>
  createHash("sha256")
    .update([...new Set(productIds)].sort((a, b) => a - b).join(","))
    .digest("hex")
    .slice(0, 24);

export const requestPricingReevaluation = async (tx: unknown, input: PricingReevaluationInput) => {
  const ids = [...new Set(input.productIds)].sort((a, b) => a - b);
  if (ids.length === 0) return null;
  const hash = scopeHash(ids);
  return createOutboxEvent(tx as never, {
    eventType: "PRICE_REEVALUATION_REQUESTED",
    aggregateType: "ProductPricing",
    aggregateId: ids[0],
    dedupeKey: "pricing-reevaluation-" + hash + "-" + input.eventVersion,
    availableAt: input.availableAt,
    payload: { productIds: ids, scopeHash: hash, eventVersion: input.eventVersion },
  });
};
