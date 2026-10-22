import { prisma } from "config/client";
import {
  claimFlashSaleQuotas,
  recordFlashSaleAllocations,
} from "modules/promotions/flash-sale-quota";
import { createProduct, createUser, resetDb } from "./fixtures";

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
});
