import { prisma } from "config/client";
import { AppError } from "lib/errors";
import { automaticDiscountPerUnit } from "modules/promotions/promotion-pricing";
import {
  toFlashSaleAvailabilityDto,
  type FlashSaleAvailabilityDto,
} from "modules/promotions/flash-sale.mapper";

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

  const winners = new Map<
    number,
    { row: AvailabilityRow; quota: AvailabilityRow["flashSalePolicy"]["quotas"][number] }
  >();
  for (const row of rows) {
    if (!row.flashSalePolicy) continue;
    for (const quota of row.flashSalePolicy.quotas) {
      const current = winners.get(quota.productId);
      const currentDiscount = current
        ? automaticDiscountPerUnit(
            {
              id: current.row.id,
              name: current.row.name,
              discountKind: current.row.discountKind,
              discountValue: current.row.discountValue,
              priority: current.row.flashSalePolicy!.priority,
              stackableWithCoupon: false,
              pricingVersion: 1,
            },
            quota.product.price,
          )
        : -1;
      const nextDiscount = automaticDiscountPerUnit(
        {
          id: row.id,
          name: row.name,
          discountKind: row.discountKind,
          discountValue: row.discountValue,
          priority: row.flashSalePolicy.priority,
          stackableWithCoupon: false,
          pricingVersion: 1,
        },
        quota.product.price,
      );
      if (
        !current ||
        row.flashSalePolicy.priority > current.row.flashSalePolicy!.priority ||
        (row.flashSalePolicy.priority === current.row.flashSalePolicy!.priority &&
          (nextDiscount > currentDiscount ||
            (nextDiscount === currentDiscount && row.id < current.row.id)))
      ) {
        winners.set(quota.productId, { row, quota });
      }
    }
  }
  return {
    serverTime: input.now,
    items: [...winners.values()]
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
