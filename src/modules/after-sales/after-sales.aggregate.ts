import { AppError } from "lib/errors";
import {
  CUSTOMER_ACTION_ITEM_STATUSES,
  TERMINAL_ITEM_STATUSES,
  type ServiceRequestItemStatus,
  type ServiceRequestStatus,
} from "modules/after-sales/after-sales.types";

const terminal = new Set<string>(TERMINAL_ITEM_STATUSES);
const customerAction = new Set<string>(CUSTOMER_ACTION_ITEM_STATUSES);

export const deriveRequestStatus = (statuses: ServiceRequestItemStatus[]): ServiceRequestStatus => {
  if (statuses.length === 0)
    throw new AppError("A service request needs at least one item", 400, "EMPTY_SERVICE_REQUEST");

  const allTerminal = statuses.every((status) => terminal.has(status));
  if (allTerminal) return "CLOSED";
  if (statuses.some((status) => terminal.has(status))) return "PARTIALLY_COMPLETED";
  if (statuses.every((status) => status === "SUBMITTED")) return "SUBMITTED";
  if (
    statuses.every((status) => status === "SUBMITTED" || status === "REVIEWING") &&
    statuses.some((status) => status === "REVIEWING")
  )
    return "REVIEWING";
  if (statuses.every((status) => customerAction.has(status))) return "AWAITING_CUSTOMER";
  return "IN_PROGRESS";
};
