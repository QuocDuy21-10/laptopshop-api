export type PriceAlertPolicyInput = {
  mode: "PERCENT_DROP" | "TARGET_PRICE";
  referencePrice: number | null;
  targetPrice: number | null;
  currentPrice: number;
};

export type PriceAlertDecision =
  | { triggered: true; reason: "PERCENT_THRESHOLD_REACHED" | "TARGET_REACHED" }
  | {
      triggered: false;
      reason: "INVALID_STATE" | "PRICE_NOT_LOWER" | "THRESHOLD_NOT_REACHED";
    };

const isPositiveInteger = (value: number | null): value is number =>
  value !== null && Number.isInteger(value) && value > 0;

export const evaluatePriceAlert = (input: PriceAlertPolicyInput): PriceAlertDecision => {
  if (!isPositiveInteger(input.currentPrice) || !isPositiveInteger(input.referencePrice)) {
    return { triggered: false, reason: "INVALID_STATE" };
  }

  if (input.mode === "PERCENT_DROP") {
    if (input.targetPrice !== null) return { triggered: false, reason: "INVALID_STATE" };
    if (input.currentPrice >= input.referencePrice) {
      return { triggered: false, reason: "PRICE_NOT_LOWER" };
    }
    return input.currentPrice * 100 <= input.referencePrice * 95
      ? { triggered: true, reason: "PERCENT_THRESHOLD_REACHED" }
      : { triggered: false, reason: "THRESHOLD_NOT_REACHED" };
  }

  if (!isPositiveInteger(input.targetPrice) || input.targetPrice >= input.referencePrice) {
    return { triggered: false, reason: "INVALID_STATE" };
  }
  return input.currentPrice <= input.targetPrice
    ? { triggered: true, reason: "TARGET_REACHED" }
    : { triggered: false, reason: "THRESHOLD_NOT_REACHED" };
};
