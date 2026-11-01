import { Prisma } from "@prisma/client";

import { AppError, notFound } from "lib/errors";

type Tx = Prisma.TransactionClient;

export const claimCouponUsage = async (
  tx: Tx,
  input: { promotionId: number; userId: number; now: Date },
) => {
  const policy = await tx.couponPolicy.findUnique({ where: { promotionId: input.promotionId } });
  if (!policy) throw notFound("Coupon");
  if (policy.maxUses !== null && policy.usedCount >= policy.maxUses) {
    throw new AppError("Promotion usage limit reached", 409, "PROMOTION_USAGE_LIMIT");
  }

  // the cap lives in the UPDATE itself: concurrent checkouts only fail when no slot is left,
  // instead of losing to whoever changed usedCount since it was read
  const global = await tx.couponPolicy.updateMany({
    where: {
      promotionId: input.promotionId,
      ...(policy.maxUses !== null ? { usedCount: { lt: policy.maxUses } } : {}),
    },
    data: { usedCount: { increment: 1 } },
  });
  if (global.count !== 1)
    throw new AppError("Promotion usage limit reached", 409, "PROMOTION_USAGE_LIMIT");

  const usage = await tx.promotionUserUsage.findUnique({
    where: { promotionId_userId: { promotionId: input.promotionId, userId: input.userId } },
  });
  if (!usage) {
    try {
      await tx.promotionUserUsage.create({
        data: { promotionId: input.promotionId, userId: input.userId, usedCount: 1 },
      });
      return;
    } catch (error) {
      // a concurrent first use created the row: fall through to the capped increment
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002")
        throw error;
    }
  } else if (usage.usedCount >= policy.maxUsesPerUser) {
    throw new AppError("Promotion user limit reached", 409, "PROMOTION_USER_LIMIT");
  }
  const userUpdated = await tx.promotionUserUsage.updateMany({
    where: {
      promotionId: input.promotionId,
      userId: input.userId,
      usedCount: { lt: policy.maxUsesPerUser },
    },
    data: { usedCount: { increment: 1 } },
  });
  if (userUpdated.count !== 1)
    throw new AppError("Promotion user limit reached", 409, "PROMOTION_USER_LIMIT");
};

export const recordCouponRedemption = async (
  tx: Tx,
  input: { promotionId: number; userId: number; orderId: number; discountAmount: number },
) =>
  tx.promotionRedemption.create({
    data: {
      promotionId: input.promotionId,
      userId: input.userId,
      orderId: input.orderId,
      discountAmount: input.discountAmount,
    },
  });

export const reverseCouponRedemption = async (
  tx: Tx,
  input: { orderId: number; reason: string; now: Date },
) => {
  const redemption = await tx.promotionRedemption.findFirst({
    where: { orderId: input.orderId, status: "APPLIED" },
  });
  if (!redemption) return false;
  const reversed = await tx.promotionRedemption.updateMany({
    where: { orderId: input.orderId, status: "APPLIED" },
    data: { status: "REVERSED", reversedAt: input.now, reverseReason: input.reason },
  });
  if (reversed.count !== 1) return false;
  await tx.couponPolicy.updateMany({
    where: { promotionId: redemption.promotionId, usedCount: { gt: 0 } },
    data: { usedCount: { decrement: 1 } },
  });
  await tx.promotionUserUsage.updateMany({
    where: { promotionId: redemption.promotionId, userId: redemption.userId, usedCount: { gt: 0 } },
    data: { usedCount: { decrement: 1 } },
  });
  return true;
};
