import type { WarrantySnapshot } from "modules/orders/order-warranty";
import type { ServiceRequestType } from "modules/after-sales/after-sales.types";

export const classifyCoverage = (
  detail: WarrantySnapshot,
  now = new Date(),
): "IN_WARRANTY" | "OUT_OF_WARRANTY" | "NO_WARRANTY" | "REQUIRES_VERIFICATION" => {
  if (detail.months === 0) return "NO_WARRANTY";
  if (detail.months === null || !detail.startAt || !detail.endAt) return "REQUIRES_VERIFICATION";
  return now <= detail.endAt ? "IN_WARRANTY" : "OUT_OF_WARRANTY";
};

export const allowedRequestTypesForCoverage = (
  coverage: ReturnType<typeof classifyCoverage>,
  availableCount: number,
): ServiceRequestType[] => {
  if (availableCount <= 0) return [];
  if (coverage === "IN_WARRANTY" || coverage === "REQUIRES_VERIFICATION")
    return ["WARRANTY", "TECHNICAL_SUPPORT"];
  return ["TECHNICAL_SUPPORT"];
};
