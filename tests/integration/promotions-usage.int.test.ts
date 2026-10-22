import { prisma } from "config/client";
import { claimCouponUsage } from "modules/promotions/promotion-usage";
import { createUser, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("promotion usage concurrency", () => {
  it("allows one winner for the last global slot", async () => {
    const user = await createUser();
    const promotion = await prisma.promotion.create({
      data: {
        kind: "COUPON",
        state: "ACTIVE",
        name: "One use",
        discountKind: "FIXED",
        discountValue: 100,
        startsAt: new Date("2026-10-01T00:00:00Z"),
        endsAt: new Date("2026-11-01T00:00:00Z"),
        createdById: user.id,
        updatedById: user.id,
        couponPolicy: { create: { code: "ONEUSE", scope: "ORDER", maxUses: 1, maxUsesPerUser: 1 } },
      },
    });
    const results = await Promise.allSettled(
      [1, 2, 3].map(async (_id) => {
        const other = await createUser();
        return prisma.$transaction((tx) =>
          claimCouponUsage(tx, { promotionId: promotion.id, userId: other.id, now: new Date() }),
        );
      }),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(
      (await prisma.couponPolicy.findUniqueOrThrow({ where: { promotionId: promotion.id } }))
        .usedCount,
    ).toBe(1);
  });
});
