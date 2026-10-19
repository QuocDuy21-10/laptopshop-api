export const STOCK_REASON = {
  OPENING: "OPENING",
  INITIAL: "INITIAL",
  ORDER: "ORDER",
  ORDER_CANCEL: "ORDER_CANCEL",
  RESTOCK: "RESTOCK",
  CORRECTION: "CORRECTION",
} as const;
export type StockReason = keyof typeof STOCK_REASON;
export const STOCK_REASONS = Object.values(STOCK_REASON) as [StockReason, ...StockReason[]];
