export const SERVICE_REQUEST_TYPES = ["WARRANTY", "TECHNICAL_SUPPORT"] as const;
export type ServiceRequestType = (typeof SERVICE_REQUEST_TYPES)[number];

export const SERVICE_REQUEST_STATUSES = [
  "SUBMITTED",
  "REVIEWING",
  "IN_PROGRESS",
  "AWAITING_CUSTOMER",
  "PARTIALLY_COMPLETED",
  "CLOSED",
] as const;
export type ServiceRequestStatus = (typeof SERVICE_REQUEST_STATUSES)[number];

export const SERVICE_REQUEST_ITEM_STATUSES = [
  "SUBMITTED",
  "REVIEWING",
  "APPROVED",
  "AWAITING_ITEM",
  "RECEIVED",
  "DIAGNOSING",
  "AWAITING_QUOTE_DECISION",
  "IN_SERVICE",
  "READY_FOR_RETURN",
  "RETURNED",
  "RESOLVED",
  "CLOSED",
  "REJECTED",
  "CANCELLED",
] as const;
export type ServiceRequestItemStatus = (typeof SERVICE_REQUEST_ITEM_STATUSES)[number];

export const TERMINAL_ITEM_STATUSES = ["CLOSED", "REJECTED", "CANCELLED"] as const;
export const CUSTOMER_ACTION_ITEM_STATUSES = [
  "AWAITING_QUOTE_DECISION",
  "RETURNED",
  "RESOLVED",
] as const;
