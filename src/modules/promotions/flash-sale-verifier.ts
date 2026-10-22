import { prisma } from "config/client";

type QuotaCounter = {
  promotionId: number;
  productId: number;
  claimedUnits: number;
};

type UserCounter = {
  promotionId: number;
  productId: number;
  userId: number;
  claimedUnits: number;
};

const quotaKey = (promotionId: number, productId: number) => `${promotionId}:${productId}`;
const userKey = (promotionId: number, productId: number, userId: number) =>
  `${promotionId}:${productId}:${userId}`;

export const verifyFlashSaleCounters = async (client: typeof prisma) => {
  const [quotas, globalAllocations, usages, userAllocations] = await Promise.all([
    client.flashSaleProductQuota.findMany({
      select: { promotionId: true, productId: true, claimedUnits: true },
    }),
    client.flashSaleAllocation.groupBy({
      by: ["promotionId", "productId"],
      where: { status: "CLAIMED" },
      _sum: { quantity: true },
    }),
    client.flashSaleUserUsage.findMany({
      select: { promotionId: true, productId: true, userId: true, claimedUnits: true },
    }),
    client.flashSaleAllocation.groupBy({
      by: ["promotionId", "productId", "userId"],
      where: { status: "CLAIMED" },
      _sum: { quantity: true },
    }),
  ]);

  const storedQuotas = new Map(
    (quotas as QuotaCounter[]).map((quota) => [
      quotaKey(quota.promotionId, quota.productId),
      quota,
    ]),
  );
  const expectedQuotas = new Map(
    globalAllocations.map((allocation) => [
      quotaKey(allocation.promotionId, allocation.productId),
      allocation._sum.quantity ?? 0,
    ]),
  );
  const quotaMismatches = [...new Set([...storedQuotas.keys(), ...expectedQuotas.keys()])]
    .map((key) => {
      const stored = storedQuotas.get(key);
      const [promotionId, productId] = key.split(":").map(Number);
      const storedUnits = stored?.claimedUnits ?? 0;
      const expected = expectedQuotas.get(key) ?? 0;
      return storedUnits === expected
        ? null
        : { promotionId, productId, stored: storedUnits, expected };
    })
    .filter((mismatch): mismatch is NonNullable<typeof mismatch> => mismatch !== null);

  const storedUsers = new Map(
    (usages as UserCounter[]).map((usage) => [
      userKey(usage.promotionId, usage.productId, usage.userId),
      usage,
    ]),
  );
  const expectedUsers = new Map(
    userAllocations.map((allocation) => [
      userKey(allocation.promotionId, allocation.productId, allocation.userId),
      allocation._sum.quantity ?? 0,
    ]),
  );
  const userMismatches = [...new Set([...storedUsers.keys(), ...expectedUsers.keys()])]
    .map((key) => {
      const stored = storedUsers.get(key);
      const [promotionId, productId, userId] = key.split(":").map(Number);
      const storedUnits = stored?.claimedUnits ?? 0;
      const expected = expectedUsers.get(key) ?? 0;
      return storedUnits === expected
        ? null
        : { promotionId, productId, userId, stored: storedUnits, expected };
    })
    .filter((mismatch): mismatch is NonNullable<typeof mismatch> => mismatch !== null);

  return {
    valid: quotaMismatches.length === 0 && userMismatches.length === 0,
    quotaMismatches,
    userMismatches,
  };
};
