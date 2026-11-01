import { Prisma } from "@prisma/client";

import { AppError } from "lib/errors";
import {
  claimCouponUsage,
  recordCouponRedemption,
  reverseCouponRedemption,
} from "modules/promotions/promotion-usage";

const tx = {
  couponPolicy: {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  },
  promotionUserUsage: {
    findUnique: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
  },
  promotionRedemption: {
    create: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn(),
  },
} as any;

beforeEach(() => jest.clearAllMocks());

it("claims the global slot before the per-user slot", async () => {
  tx.couponPolicy.findUnique.mockResolvedValue({ promotionId: 10, maxUses: 2, usedCount: 1 });
  tx.couponPolicy.updateMany.mockResolvedValue({ count: 1 });
  tx.promotionUserUsage.findUnique.mockResolvedValue({ promotionId: 10, userId: 7, usedCount: 0 });
  tx.promotionUserUsage.updateMany.mockResolvedValue({ count: 1 });

  await claimCouponUsage(tx, { promotionId: 10, userId: 7, now: new Date() });
  expect(tx.couponPolicy.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
    tx.promotionUserUsage.updateMany.mock.invocationCallOrder[0],
  );
});

it("claims against the remaining cap so concurrent checkouts do not reject each other", async () => {
  tx.couponPolicy.findUnique.mockResolvedValue({
    promotionId: 10,
    maxUses: 5,
    usedCount: 1,
    maxUsesPerUser: 2,
  });
  tx.couponPolicy.updateMany.mockResolvedValue({ count: 1 });
  tx.promotionUserUsage.findUnique.mockResolvedValue({ promotionId: 10, userId: 7, usedCount: 1 });
  tx.promotionUserUsage.updateMany.mockResolvedValue({ count: 1 });

  await claimCouponUsage(tx, { promotionId: 10, userId: 7, now: new Date() });
  expect(tx.couponPolicy.updateMany).toHaveBeenCalledWith({
    where: { promotionId: 10, usedCount: { lt: 5 } },
    data: { usedCount: { increment: 1 } },
  });
  expect(tx.promotionUserUsage.updateMany).toHaveBeenCalledWith({
    where: { promotionId: 10, userId: 7, usedCount: { lt: 2 } },
    data: { usedCount: { increment: 1 } },
  });
});

it("claims an unlimited coupon without a cap condition", async () => {
  tx.couponPolicy.findUnique.mockResolvedValue({
    promotionId: 10,
    maxUses: null,
    usedCount: 40,
    maxUsesPerUser: 1,
  });
  tx.couponPolicy.updateMany.mockResolvedValue({ count: 1 });
  tx.promotionUserUsage.findUnique.mockResolvedValue(null);
  tx.promotionUserUsage.create.mockResolvedValue({ usedCount: 1 });

  await claimCouponUsage(tx, { promotionId: 10, userId: 7, now: new Date() });
  expect(tx.couponPolicy.updateMany).toHaveBeenCalledWith({
    where: { promotionId: 10 },
    data: { usedCount: { increment: 1 } },
  });
});

it("falls back to the capped increment when a concurrent first use created the user row", async () => {
  tx.couponPolicy.findUnique.mockResolvedValue({
    promotionId: 10,
    maxUses: null,
    usedCount: 0,
    maxUsesPerUser: 2,
  });
  tx.couponPolicy.updateMany.mockResolvedValue({ count: 1 });
  tx.promotionUserUsage.findUnique.mockResolvedValue(null);
  tx.promotionUserUsage.create.mockRejectedValue(
    new Prisma.PrismaClientKnownRequestError("P2002", { code: "P2002", clientVersion: "6.3.0" }),
  );
  tx.promotionUserUsage.updateMany.mockResolvedValue({ count: 1 });

  await expect(
    claimCouponUsage(tx, { promotionId: 10, userId: 7, now: new Date() }),
  ).resolves.toBeUndefined();
  expect(tx.promotionUserUsage.updateMany).toHaveBeenCalledWith({
    where: { promotionId: 10, userId: 7, usedCount: { lt: 2 } },
    data: { usedCount: { increment: 1 } },
  });
});

it("rejects a global usage limit", async () => {
  tx.couponPolicy.findUnique.mockResolvedValue({ promotionId: 10, maxUses: 1, usedCount: 1 });
  await expect(
    claimCouponUsage(tx, { promotionId: 10, userId: 7, now: new Date() }),
  ).rejects.toMatchObject(
    new AppError("Promotion usage limit reached", 409, "PROMOTION_USAGE_LIMIT"),
  );
});

it("records and reverses one redemption exactly once", async () => {
  tx.promotionRedemption.create.mockResolvedValue({ id: 1 });
  await recordCouponRedemption(tx, {
    promotionId: 10,
    userId: 7,
    orderId: 50,
    discountAmount: 100,
  });
  expect(tx.promotionRedemption.create).toHaveBeenCalled();
  tx.promotionRedemption.findFirst.mockResolvedValue({ promotionId: 10, userId: 7 });
  tx.promotionRedemption.updateMany.mockResolvedValue({ count: 1 });
  tx.couponPolicy.updateMany.mockResolvedValue({ count: 1 });
  tx.promotionUserUsage.updateMany.mockResolvedValue({ count: 1 });
  await expect(
    reverseCouponRedemption(tx, { orderId: 50, reason: "CANCELLED", now: new Date() }),
  ).resolves.toBe(true);
  tx.promotionRedemption.updateMany.mockResolvedValue({ count: 0 });
  await expect(
    reverseCouponRedemption(tx, { orderId: 50, reason: "CANCELLED", now: new Date() }),
  ).resolves.toBe(false);
});
