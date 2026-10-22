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

  const global = await tx.couponPolicy.updateMany({
    where: { promotionId: input.promotionId, usedCount: policy.usedCount },
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
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002")
        throw error;
      throw new AppError("Promotion user limit reached", 409, "PROMOTION_USER_LIMIT");
    }
  }
  if (usage.usedCount >= policy.maxUsesPerUser) {
    throw new AppError("Promotion user limit reached", 409, "PROMOTION_USER_LIMIT");
  }
  const userUpdated = await tx.promotionUserUsage.updateMany({
    where: {
      promotionId: input.promotionId,
      userId: input.userId,
      usedCount: usage.usedCount,
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
