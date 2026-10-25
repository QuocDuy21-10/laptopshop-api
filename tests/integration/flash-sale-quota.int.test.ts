import { prisma } from "config/client";
import {
  claimFlashSaleQuotas,
  recordFlashSaleAllocations,
} from "modules/promotions/flash-sale-quota";
import { changeStatus, placeOrder } from "modules/orders/orders.service";
import { quoteOrder } from "modules/promotions/promotions.service";
import { createProduct, createUser, putInCart, receiver, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("Flash Sale quota concurrency", () => {
  it("does not exceed global quota when users claim the last units concurrently", async () => {
    const product = await createProduct(10);
    const users = [await createUser(), await createUser(), await createUser()];
    const promotion = await prisma.promotion.create({
      data: {
        kind: "FLASH_SALE",
        state: "ACTIVE",
        name: "Flash",
        discountKind: "FIXED",
        discountValue: 100,
        startsAt: new Date("2026-10-01"),
        endsAt: new Date("2026-11-01"),
        createdById: users[0].id,
        updatedById: users[0].id,
        flashSalePolicy: { create: {} },
        flashSaleQuotas: { create: { productId: product.id, totalQuota: 2, maxUnitsPerUser: 2 } },
      },
    });

    const results = await Promise.all(
      users.map(async (user) => {
        try {
          return await prisma.$transaction(async (tx) => {
            const order = await tx.order.create({
              data: {
                totalPrice: 900,
                subtotalPrice: 1000,
                receiverName: "R",
                receiverAddress: "A",
                receiverPhone: "0900000000",
                paymentMethod: "COD",
                paymentStatus: "PAYMENT_UNPAID",
                userId: user.id,
                orderDetails: { create: { productId: product.id, price: 1000, quantity: 1 } },
              },
              include: { orderDetails: true },
            });
            await claimFlashSaleQuotas(tx, {
              userId: user.id,
              now: new Date("2026-10-22"),
              claims: [
                {
                  promotionId: promotion.id,
                  productId: product.id,
                  quantity: 1,
                  pricingVersion: 1,
                },
              ],
            });
            await recordFlashSaleAllocations(tx, {
              userId: user.id,
              orderId: order.id,
              lines: [
                {
                  orderDetailId: order.orderDetails[0].id,
                  promotionId: promotion.id,
                  productId: product.id,
                  quantity: 1,
                  discountAmount: 100,
                },
              ],
            });
            return true;
          });
        } catch {
          return false;
        }
      }),
    );

    expect(results.filter(Boolean)).toHaveLength(2);
    await expect(
      prisma.flashSaleProductQuota.findUniqueOrThrow({
        where: { promotionId_productId: { promotionId: promotion.id, productId: product.id } },
      }),
    ).resolves.toMatchObject({ claimedUnits: 2 });
  });

  it("rolls back order, stock and coupon release when a Flash Sale counter is corrupt", async () => {
    const product = await createProduct(5, 1_000);
    const user = await createUser();
    const window = {
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 10 * 60_000),
    };
    const flash = await prisma.promotion.create({
      data: {
        kind: "FLASH_SALE",
        state: "ACTIVE",
        name: "Flash rollback",
        discountKind: "PERCENT",
        discountValue: 20,
        ...window,
        createdById: user.id,
        updatedById: user.id,
        flashSalePolicy: { create: { priority: 10, stackableWithCoupon: true } },
        flashSaleQuotas: { create: { productId: product.id, totalQuota: 5, maxUnitsPerUser: 5 } },
      },
    });
    const coupon = await prisma.promotion.create({
      data: {
        kind: "COUPON",
        state: "ACTIVE",
        name: "Coupon rollback",
        discountKind: "PERCENT",
        discountValue: 10,
        ...window,
        createdById: user.id,
        updatedById: user.id,
        couponPolicy: {
          create: { code: "ROLLBACK10", scope: "ORDER", maxUses: 5, maxUsesPerUser: 5 },
        },
      },
    });
    await putInCart(user.id, product.id, 2);
    const quote = await quoteOrder(user.id, "ROLLBACK10");
    const { order } = await placeOrder(user.id, "flash-release-rollback", {
      ...receiver,
      couponCode: "ROLLBACK10",
      pricingFingerprint: quote.pricingFingerprint,
    });
    await prisma.flashSaleUserUsage.update({
      where: {
        promotionId_productId_userId: {
          promotionId: flash.id,
          productId: product.id,
          userId: user.id,
        },
      },
      data: { claimedUnits: 0 },
    });

    await expect(changeStatus(order.id, "CANCELLED", { actorId: user.id })).rejects.toMatchObject({
      code: "FLASH_SALE_COUNTER_MISMATCH",
      details: { promotionId: flash.id, productId: product.id, userId: user.id, quantity: 2 },
    });

    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: order.id } }),
    ).resolves.toMatchObject({ status: "PENDING" });
    await expect(
      prisma.product.findUniqueOrThrow({ where: { id: product.id } }),
    ).resolves.toMatchObject({ quantity: 3, sold: 2 });
    await expect(
      prisma.couponPolicy.findUniqueOrThrow({ where: { promotionId: coupon.id } }),
    ).resolves.toMatchObject({ usedCount: 1 });
    await expect(
      prisma.promotionUserUsage.findUniqueOrThrow({
        where: { promotionId_userId: { promotionId: coupon.id, userId: user.id } },
      }),
    ).resolves.toMatchObject({ usedCount: 1 });
    await expect(
      prisma.promotionRedemption.findUniqueOrThrow({ where: { orderId: order.id } }),
    ).resolves.toMatchObject({ status: "APPLIED" });
    await expect(
      prisma.flashSaleProductQuota.findUniqueOrThrow({
        where: { promotionId_productId: { promotionId: flash.id, productId: product.id } },
      }),
    ).resolves.toMatchObject({ claimedUnits: 2 });
    await expect(
      prisma.flashSaleUserUsage.findUniqueOrThrow({
        where: {
          promotionId_productId_userId: {
            promotionId: flash.id,
            productId: product.id,
            userId: user.id,
          },
        },
      }),
    ).resolves.toMatchObject({ claimedUnits: 0 });
    await expect(
      prisma.flashSaleAllocation.findFirstOrThrow({ where: { orderId: order.id } }),
    ).resolves.toMatchObject({ status: "CLAIMED" });
  });
});
