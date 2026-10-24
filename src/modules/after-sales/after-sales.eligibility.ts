import type { WarrantySnapshot } from "modules/orders/order-warranty";
import type { ServiceRequestType } from "modules/after-sales/after-sales.types";

export type WarrantySnapshotWithSource = WarrantySnapshot & {
  policySource?: "CHECKOUT_SNAPSHOT" | "CURRENT_PRODUCT_POLICY_BACKFILL" | "UNAVAILABLE";
};

export type LatestWarrantyVerification = {
  decision: "IN_WARRANTY" | "OUT_OF_WARRANTY" | "NO_WARRANTY" | "UNVERIFIABLE";
  warrantyStartAt: Date | null;
  warrantyEndAt: Date | null;
};

export const effectiveCoverage = (
  detail: WarrantySnapshotWithSource,
  latestVerification: LatestWarrantyVerification | null = null,
  now = new Date(),
): "IN_WARRANTY" | "OUT_OF_WARRANTY" | "NO_WARRANTY" | "REQUIRES_VERIFICATION" => {
  if (latestVerification) {
    if (latestVerification.decision === "IN_WARRANTY") return "IN_WARRANTY";
    if (latestVerification.decision === "OUT_OF_WARRANTY") return "OUT_OF_WARRANTY";
    if (latestVerification.decision === "NO_WARRANTY") return "NO_WARRANTY";
    return "REQUIRES_VERIFICATION";
  }
  if (
    detail.policySource === "CURRENT_PRODUCT_POLICY_BACKFILL" ||
    detail.policySource === "UNAVAILABLE"
  )
    return "REQUIRES_VERIFICATION";
  if (detail.months === 0) return "NO_WARRANTY";
  if (detail.months === null || !detail.startAt || !detail.endAt) return "REQUIRES_VERIFICATION";
  return now <= detail.endAt ? "IN_WARRANTY" : "OUT_OF_WARRANTY";
};

export const classifyCoverage = (
  detail: WarrantySnapshotWithSource,
  now = new Date(),
): "IN_WARRANTY" | "OUT_OF_WARRANTY" | "NO_WARRANTY" | "REQUIRES_VERIFICATION" =>
  effectiveCoverage(detail, null, now);

export const allowedRequestTypesForCoverage = (
  coverage: ReturnType<typeof classifyCoverage>,
  availableCount: number,
): ServiceRequestType[] => {
  if (availableCount <= 0) return [];
  if (coverage === "IN_WARRANTY" || coverage === "REQUIRES_VERIFICATION")
    return ["WARRANTY", "TECHNICAL_SUPPORT"];
  return ["TECHNICAL_SUPPORT"];
};
