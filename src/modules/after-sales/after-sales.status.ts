import { AppError } from "lib/errors";
import type {
  ServiceRequestItemStatus,
  ServiceRequestType,
} from "modules/after-sales/after-sales.types";

export type TransitionContext = {
  now?: Date;
  quoteAccepted?: boolean;
  confirmationDueAt?: Date | null;
  closeMode?: "CUSTOMER_CONFIRMATION" | "TIMEOUT" | "ADMINISTRATIVE";
};

const earlyCancelable = new Set<ServiceRequestItemStatus>([
  "SUBMITTED",
  "REVIEWING",
  "APPROVED",
  "AWAITING_ITEM",
]);

const commonTransitions: Record<ServiceRequestItemStatus, ServiceRequestItemStatus[]> = {
  SUBMITTED: ["REVIEWING", "CANCELLED"],
  REVIEWING: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["AWAITING_ITEM", "DIAGNOSING", "CANCELLED"],
  AWAITING_ITEM: ["RECEIVED", "CANCELLED"],
  RECEIVED: ["DIAGNOSING"],
  DIAGNOSING: ["IN_SERVICE", "RESOLVED", "READY_FOR_RETURN"],
  AWAITING_QUOTE_DECISION: ["DIAGNOSING", "IN_SERVICE", "AWAITING_ITEM"],
  IN_SERVICE: ["RESOLVED", "READY_FOR_RETURN"],
  READY_FOR_RETURN: ["RETURNED"],
  RETURNED: ["CLOSED", "REVIEWING"],
  RESOLVED: ["CLOSED", "REVIEWING"],
  CLOSED: [],
  REJECTED: [],
  CANCELLED: [],
};

const invalidTransition = () =>
  new AppError("Invalid service request transition", 409, "INVALID_SERVICE_TRANSITION");

export const canTransition = (
  type: ServiceRequestType,
  from: ServiceRequestItemStatus,
  to: ServiceRequestItemStatus,
  context: TransitionContext = {},
) => {
  if (!commonTransitions[from]?.includes(to)) return false;
  if (type === "WARRANTY" && from === "DIAGNOSING" && to === "AWAITING_QUOTE_DECISION")
    return false;
  if (
    type === "TECHNICAL_SUPPORT" &&
    from === "AWAITING_QUOTE_DECISION" &&
    ["IN_SERVICE", "AWAITING_ITEM"].includes(to) &&
    context.quoteAccepted !== true
  )
    return false;
  if (to === "CANCELLED" && !earlyCancelable.has(from)) return false;
  if (to === "CLOSED") {
    if (context.closeMode === "CUSTOMER_CONFIRMATION")
      return from === "RETURNED" || from === "RESOLVED";
    if (context.closeMode === "TIMEOUT" || context.closeMode === "ADMINISTRATIVE") {
      return (
        (from === "RETURNED" || from === "RESOLVED") &&
        context.confirmationDueAt !== null &&
        context.confirmationDueAt !== undefined &&
        (context.now ?? new Date()) >= context.confirmationDueAt
      );
    }
    return false;
  }
  return true;
};

export const assertTransition = (
  type: ServiceRequestType,
  from: ServiceRequestItemStatus,
  to: ServiceRequestItemStatus,
  context: TransitionContext = {},
) => {
  if (!canTransition(type, from, to, context)) throw invalidTransition();
};
