import { productImage } from "modules/products/products.mapper";
import {
  allowedRequestTypesForCoverage,
  classifyCoverage,
} from "modules/after-sales/after-sales.eligibility";
import type { EligibleDeviceRow } from "modules/after-sales/after-sales.repository";
import type { CustomerServiceRequestRow } from "modules/after-sales/after-sales.repository";
import type { ServiceRequestType } from "modules/after-sales/after-sales.types";

export type EligibleDeviceDto = {
  orderDetailId: number;
  orderId: number;
  product: { id: number; name: string; image: string | null };
  quantity: number;
  activeCount: number;
  availableCount: number;
  warrantyMonthsSnapshot: number | null;
  warrantyStartAt: Date | null;
  warrantyEndAt: Date | null;
  warrantyPolicySource: string;
  coverage: ReturnType<typeof classifyCoverage>;
  allowed: boolean;
  reason: string | null;
  allowedRequestTypes: ServiceRequestType[];
};

export const effectiveQuoteStatus = (
  quote: { status: string; validUntil: Date },
  now = new Date(),
) => (quote.status === "SENT" && quote.validUntil <= now ? "EXPIRED" : quote.status);

const customerActionsFor = (
  item: { status: string },
  quotes: Array<{ status: string; validUntil: Date }>,
  now: Date,
) => {
  const actions: string[] = [];
  if (["SUBMITTED", "REVIEWING", "APPROVED", "AWAITING_ITEM"].includes(item.status))
    actions.push("CANCEL");
  if (["RETURNED", "RESOLVED"].includes(item.status)) actions.push("CONFIRM", "DISPUTE");
  if (quotes.some((quote) => effectiveQuoteStatus(quote, now) === "SENT"))
    actions.push("DECIDE_QUOTE");
  return actions;
};

export const toEligibleDeviceDto = (
  row: EligibleDeviceRow,
  requestedType: ServiceRequestType,
  now = new Date(),
): EligibleDeviceDto => {
  const activeCount = row.serviceRequestItems.length;
  const availableCount = Math.max(0, row.quantity - activeCount);
  const coverage = classifyCoverage(
    {
      months: row.warrantyMonthsSnapshot,
      startAt: row.warrantyStartAt,
      endAt: row.warrantyEndAt,
    },
    now,
  );
  const allowedRequestTypes = allowedRequestTypesForCoverage(coverage, availableCount);
  const allowed = allowedRequestTypes.includes(requestedType);
  const reason = allowed
    ? null
    : availableCount <= 0
      ? "ACTIVE_DEVICE_LIMIT_REACHED"
      : coverage === "OUT_OF_WARRANTY"
        ? "WARRANTY_EXPIRED"
        : coverage === "NO_WARRANTY"
          ? "NO_WARRANTY"
          : "WARRANTY_NOT_AVAILABLE";

  return {
    orderDetailId: row.id,
    orderId: row.order.id,
    product: {
      id: row.product.id,
      name: row.product.name,
      image: productImage(row.product.image),
    },
    quantity: row.quantity,
    activeCount,
    availableCount,
    warrantyMonthsSnapshot: row.warrantyMonthsSnapshot,
    warrantyStartAt: row.warrantyStartAt,
    warrantyEndAt: row.warrantyEndAt,
    warrantyPolicySource: row.warrantyPolicySource,
    coverage,
    allowed,
    reason,
    allowedRequestTypes,
  };
};

export const toCustomerServiceRequestDto = (row: CustomerServiceRequestRow) => ({
  id: row.id,
  code: row.code,
  type: row.type,
  status: row.status,
  subject: row.subject,
  previousRequestId: row.previousRequestId,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  closedAt: row.closedAt,
  items: row.items.map((item) => ({
    id: item.id,
    orderDetailId: item.orderDetailId,
    orderId: item.orderDetail.orderId,
    position: item.position,
    productNameSnapshot: item.productNameSnapshot,
    deviceLabel: item.deviceLabel,
    serialNumber: item.serialNumber,
    issueDescription: item.issueDescription,
    coverageAtCreation: item.coverageAtCreation,
    status: item.status,
    resolution: item.resolution,
    version: item.version,
    resolvedAt: item.resolvedAt,
    returnedAt: item.returnedAt,
    confirmationDueAt: item.confirmationDueAt,
    customerConfirmedAt: item.customerConfirmedAt,
    closedAt: item.closedAt,
    closeReason: item.closeReason,
    allowedActions: customerActionsFor(item, item.quotes, new Date()),
    quotes: item.quotes.map((quote) => ({
      id: quote.id,
      version: quote.version,
      status: effectiveQuoteStatus(quote),
      currency: quote.currency,
      subtotal: quote.subtotal,
      total: quote.total,
      note: quote.note,
      validUntil: quote.validUntil,
      respondedAt: quote.respondedAt,
      createdAt: quote.createdAt,
      lines: quote.lines.map((line) => ({
        id: line.id,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
        position: line.position,
      })),
    })),
  })),
  previousRequest: row.previousRequest,
  followUps: row.followUps ?? [],
  events: row.events.map((event) => ({
    id: event.id,
    itemId: event.serviceRequestItemId,
    kind: event.kind,
    visibility: event.visibility,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    body: event.body,
    createdAt: event.createdAt,
  })),
});
