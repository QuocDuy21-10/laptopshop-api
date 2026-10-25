import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { AppError } from "lib/errors";

type Tx = Prisma.TransactionClient | PrismaClient;
type Claim = { promotionId: number; productId: number; quantity: number; pricingVersion: number };

const tupleCompare = (
  a: { promotionId: number; productId: number },
  b: { promotionId: number; productId: number },
) => a.promotionId - b.promotionId || a.productId - b.productId;

const lockPromotions = async (tx: Tx, promotionIds: number[]) => {
  if (promotionIds.length === 0)
    return new Map<
      number,
      { state: string; startsAt: Date; endsAt: Date; pricingVersion: number }
    >();
  const rows = await tx.$queryRaw<
    Array<{ id: number; state: string; startsAt: Date; endsAt: Date; pricingVersion: number }>
  >(
    Prisma.sql`SELECT id, state, startsAt, endsAt, pricingVersion FROM promotions WHERE id IN (${Prisma.join(promotionIds)}) ORDER BY id ASC FOR UPDATE`,
  );
  return new Map(rows.map((row) => [row.id, row]));
};

const validatePromotion = (
  promotion: { state: string; startsAt: Date; endsAt: Date; pricingVersion: number } | undefined,
  claim: Claim,
  now: Date,
) => {
  if (
    !promotion ||
    promotion.state !== "ACTIVE" ||
    now < promotion.startsAt ||
    now >= promotion.endsAt
  ) {
    throw new AppError("Promotion pricing changed", 409, "PROMOTION_CHANGED", {
      promotionId: claim.promotionId,
    });
  }
  if (promotion.pricingVersion !== claim.pricingVersion) {
    throw new AppError("Promotion configuration changed", 409, "PROMOTION_CHANGED", {
      promotionId: claim.promotionId,
    });
  }
};

export const claimFlashSaleQuotas = async (
  tx: Tx,
  input: { userId: number; now: Date; claims: Claim[] },
) => {
  const claims = [...input.claims].sort(tupleCompare).reduce<Claim[]>((result, claim) => {
    if (claim.quantity <= 0)
      throw new AppError("Claim quantity must be positive", 400, "VALIDATION_ERROR");
    const previous = result.at(-1);
    if (previous?.promotionId === claim.promotionId && previous.productId === claim.productId) {
      previous.quantity += claim.quantity;
    } else {
      result.push({ ...claim });
    }
    return result;
  }, []);
  const promotions = await lockPromotions(
    tx,
    [...new Set(claims.map((claim) => claim.promotionId))].sort((a, b) => a - b),
  );
  const lockedAt = new Date();

  for (const claim of claims) {
    validatePromotion(promotions.get(claim.promotionId), claim, lockedAt);
    const quota = await tx.flashSaleProductQuota.findUnique({
      where: {
        promotionId_productId: { promotionId: claim.promotionId, productId: claim.productId },
      },
    });
    if (!quota)
      throw new AppError("Flash Sale configuration changed", 409, "PROMOTION_CHANGED", {
        promotionId: claim.promotionId,
        productId: claim.productId,
      });

    const global = await tx.flashSaleProductQuota.updateMany({
      where: {
        promotionId: claim.promotionId,
        productId: claim.productId,
        claimedUnits: { lte: quota.totalQuota - claim.quantity },
      },
      data: { claimedUnits: { increment: claim.quantity } },
    });
    if (global.count !== 1) {
      const current = await tx.flashSaleProductQuota.findUnique({
        where: {
          promotionId_productId: { promotionId: claim.promotionId, productId: claim.productId },
        },
        select: { claimedUnits: true, totalQuota: true },
      });
      throw new AppError("Flash Sale quota exceeded", 409, "FLASH_SALE_QUOTA_EXCEEDED", {
        promotionId: claim.promotionId,
        productId: claim.productId,
        requestedQuantity: claim.quantity,
        remainingQuota: Math.max(
          0,
          (current?.totalQuota ?? quota.totalQuota) - (current?.claimedUnits ?? quota.claimedUnits),
        ),
      });
    }

    await tx.flashSaleUserUsage.upsert({
      where: {
        promotionId_productId_userId: {
          promotionId: claim.promotionId,
          productId: claim.productId,
          userId: input.userId,
        },
      },
      create: {
        promotionId: claim.promotionId,
        productId: claim.productId,
        userId: input.userId,
        claimedUnits: 0,
      },
      update: {},
    });
    const user = await tx.flashSaleUserUsage.updateMany({
      where: {
        promotionId: claim.promotionId,
        productId: claim.productId,
        userId: input.userId,
        claimedUnits: { lte: quota.maxUnitsPerUser - claim.quantity },
      },
      data: { claimedUnits: { increment: claim.quantity } },
    });
    if (user.count !== 1) {
      const current = await tx.flashSaleUserUsage.findUnique({
        where: {
          promotionId_productId_userId: {
            promotionId: claim.promotionId,
            productId: claim.productId,
            userId: input.userId,
          },
        },
        select: { claimedUnits: true },
      });
      throw new AppError("Flash Sale user limit exceeded", 409, "FLASH_SALE_USER_LIMIT", {
        promotionId: claim.promotionId,
        productId: claim.productId,
        requestedQuantity: claim.quantity,
        userRemainingQuota: Math.max(0, quota.maxUnitsPerUser - (current?.claimedUnits ?? 0)),
      });
    }
  }
};

export const recordFlashSaleAllocations = async (
  tx: Tx,
  input: {
    userId: number;
    orderId: number;
    lines: Array<{
      orderDetailId: number;
      promotionId: number;
      productId: number;
      quantity: number;
      discountAmount: number;
    }>;
  },
) => {
  for (const line of [...input.lines].sort(
    (a, b) => tupleCompare(a, b) || a.orderDetailId - b.orderDetailId,
  )) {
    await tx.flashSaleAllocation.create({
      data: {
        orderDetailId: line.orderDetailId,
        promotionId: line.promotionId,
        productId: line.productId,
        userId: input.userId,
        orderId: input.orderId,
        quantity: line.quantity,
        discountAmount: line.discountAmount,
      },
    });
  }
};

export const releaseFlashSaleAllocations = async (
  tx: Tx,
  input: { orderId: number; reason: string; now: Date },
) => {
  const allocations =
    (await tx.flashSaleAllocation.findMany({
      where: { orderId: input.orderId, status: "CLAIMED" },
      orderBy: [{ promotionId: "asc" }, { productId: "asc" }, { id: "asc" }],
    })) ?? [];
  let releasedUnits = 0;
  for (const allocation of allocations) {
    const transitioned = await tx.flashSaleAllocation.updateMany({
      where: { id: allocation.id, status: "CLAIMED" },
      data: { status: "RELEASED", releasedAt: input.now, releaseReason: input.reason.slice(0, 50) },
    });
    if (transitioned.count !== 1) continue;
    await tx.flashSaleProductQuota.updateMany({
      where: {
        promotionId: allocation.promotionId,
        productId: allocation.productId,
        claimedUnits: { gte: allocation.quantity },
      },
      data: { claimedUnits: { decrement: allocation.quantity } },
    });
    await tx.flashSaleUserUsage.updateMany({
      where: {
        promotionId: allocation.promotionId,
        productId: allocation.productId,
        userId: allocation.userId,
        claimedUnits: { gte: allocation.quantity },
      },
      data: { claimedUnits: { decrement: allocation.quantity } },
    });
    releasedUnits += allocation.quantity;
  }
  return releasedUnits;
};
