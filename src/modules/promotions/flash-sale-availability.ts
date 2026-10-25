import { prisma } from "config/client";
import { AppError } from "lib/errors";
import {
  isFlashSaleAvailabilityEligible,
  toFlashSaleAvailabilityDto,
  type FlashSaleAvailabilityDto,
} from "modules/promotions/flash-sale.mapper";
import { effectivePromotionState } from "modules/promotions/promotions.mapper";
import { comparePromotionCandidates } from "modules/promotions/promotion-selection";

type AvailabilityInput = { productIds: number[]; userId?: number; now: Date };
type AvailabilityRow = {
  id: number;
  name: string;
  state: "ACTIVE";
  discountKind: "PERCENT" | "FIXED";
  discountValue: number;
  startsAt: Date;
  endsAt: Date;
  flashSalePolicy: {
    priority: number;
    showRemainingQuota: boolean;
    quotas: Array<{
      productId: number;
      totalQuota: number;
      claimedUnits: number;
      maxUnitsPerUser: number;
      product: { price: number };
      usages?: Array<{ userId: number; claimedUnits: number }>;
    }>;
  } | null;
};

type AvailabilityCandidate = {
  row: AvailabilityRow;
  quota: NonNullable<AvailabilityRow["flashSalePolicy"]>["quotas"][number];
};

const compareAvailabilityCandidates = (a: AvailabilityCandidate, b: AvailabilityCandidate) =>
  comparePromotionCandidates(
    {
      id: a.row.id,
      name: a.row.name,
      discountKind: a.row.discountKind,
      discountValue: a.row.discountValue,
      priority: a.row.flashSalePolicy!.priority,
      stackableWithCoupon: false,
      pricingVersion: 1,
    },
    {
      id: b.row.id,
      name: b.row.name,
      discountKind: b.row.discountKind,
      discountValue: b.row.discountValue,
      priority: b.row.flashSalePolicy!.priority,
      stackableWithCoupon: false,
      pricingVersion: 1,
    },
    a.quota.product.price,
  );

const isEligibleForOneUnit = (candidate: AvailabilityCandidate, userId?: number) =>
  isFlashSaleAvailabilityEligible({
    quota: candidate.quota,
    userClaimedUnits: candidate.quota.usages?.[0]?.claimedUnits,
    userId,
  });

export const getFlashSaleAvailability = async (
  input: AvailabilityInput,
): Promise<{ serverTime: Date; items: FlashSaleAvailabilityDto[] }> => {
  const productIds = [...input.productIds];
  if (
    productIds.length === 0 ||
    productIds.length > 20 ||
    new Set(productIds).size !== productIds.length ||
    productIds.some((id) => !Number.isInteger(id) || id <= 0)
  ) {
    throw new AppError(
      "productIds must contain 1 to 20 positive unique IDs",
      400,
      "VALIDATION_ERROR",
    );
  }
  const rows = (await prisma.promotion.findMany({
    where: {
      kind: "FLASH_SALE",
      state: "ACTIVE",
      endsAt: { gt: input.now },
      flashSalePolicy: { quotas: { some: { productId: { in: productIds } } } },
    },
    include: {
      flashSalePolicy: {
        include: {
          quotas: {
            where: { productId: { in: productIds } },
            include: {
              product: { select: { price: true } },
              ...(input.userId === undefined
                ? {}
                : { usages: { where: { userId: input.userId } } }),
            },
          },
        },
      },
    },
  })) as unknown as AvailabilityRow[];

  const candidatesByProduct = new Map<
    number,
    { running: AvailabilityCandidate[]; scheduled: AvailabilityCandidate[] }
  >();
  for (const row of rows) {
    if (!row.flashSalePolicy) continue;
    const state = effectivePromotionState(row.state, row.startsAt, row.endsAt, input.now);
    if (state !== "RUNNING" && state !== "SCHEDULED") continue;
    for (const quota of row.flashSalePolicy.quotas) {
      const candidates = candidatesByProduct.get(quota.productId) ?? { running: [], scheduled: [] };
      candidates[state === "RUNNING" ? "running" : "scheduled"].push({ row, quota });
      candidatesByProduct.set(quota.productId, candidates);
    }
  }
  const winners = [...candidatesByProduct.values()].flatMap(({ running, scheduled }) => {
    const sortedRunning = [...running].sort(compareAvailabilityCandidates);
    const winner =
      sortedRunning.find((candidate) => isEligibleForOneUnit(candidate, input.userId)) ??
      sortedRunning[0] ??
      [...scheduled].sort(compareAvailabilityCandidates)[0];
    return winner ? [winner] : [];
  });
  return {
    serverTime: input.now,
    items: winners
      .sort((a, b) => a.quota.productId - b.quota.productId)
      .map(({ row, quota }) =>
        toFlashSaleAvailabilityDto({
          promotion: row,
          quota,
          userClaimedUnits: quota.usages?.[0]?.claimedUnits,
          userId: input.userId,
          showRemainingQuota: row.flashSalePolicy!.showRemainingQuota,
          now: input.now,
        }),
      ),
  };
};
