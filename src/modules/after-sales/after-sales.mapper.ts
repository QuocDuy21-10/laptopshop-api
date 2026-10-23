import { productImage } from "modules/products/products.mapper";
import {
  allowedRequestTypesForCoverage,
  classifyCoverage,
} from "modules/after-sales/after-sales.eligibility";
import type { EligibleDeviceRow } from "modules/after-sales/after-sales.repository";
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
