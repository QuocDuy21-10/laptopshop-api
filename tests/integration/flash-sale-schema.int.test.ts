import { prisma } from "config/client";
import { createProduct, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const promotionData = {
  kind: "FLASH_SALE" as const,
  state: "DRAFT" as const,
  name: "Flash Sale",
  discountKind: "PERCENT" as const,
  discountValue: 20,
  startsAt: new Date("2026-10-01T00:00:00.000Z"),
  endsAt: new Date("2026-11-01T00:00:00.000Z"),
};

describe("flash sale schema contract", () => {
  it("enforces composite quota and user usage uniqueness", async () => {
    const user = await createUser();
    const product = await createProduct(2);
    const promotion = await prisma.promotion.create({
      data: {
        ...promotionData,
        createdById: user.id,
        updatedById: user.id,
        flashSalePolicy: { create: {} },
        flashSaleQuotas: {
          create: { productId: product.id, totalQuota: 2, maxUnitsPerUser: 1 },
        },
      },
    });

    await expect(
      prisma.flashSaleProductQuota.create({
        data: {
          promotionId: promotion.id,
          productId: product.id,
          totalQuota: 2,
          maxUnitsPerUser: 1,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    await expect(
      prisma.flashSaleUserUsage.create({
        data: { promotionId: promotion.id, productId: product.id, userId: user.id },
      }),
    ).resolves.toBeDefined();
    await expect(
      prisma.flashSaleUserUsage.create({
        data: { promotionId: promotion.id, productId: product.id, userId: user.id },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("allows only one allocation per order detail and restricts history dependencies", async () => {
    const user = await createUser();
    const product = await createProduct(2);
    const promotion = await prisma.promotion.create({
      data: {
        ...promotionData,
        createdById: user.id,
        updatedById: user.id,
        flashSalePolicy: { create: {} },
        flashSaleQuotas: {
          create: { productId: product.id, totalQuota: 2, claimedUnits: 1, maxUnitsPerUser: 1 },
        },
      },
    });
    const order = await prisma.order.create({
      data: {
        totalPrice: 800,
        subtotalPrice: 1000,
        receiverName: "R",
        receiverAddress: "Addr",
        receiverPhone: "0900000000",
        paymentMethod: "COD",
        paymentStatus: "PAYMENT_UNPAID",
        userId: user.id,
        orderDetails: { create: { productId: product.id, price: 1000, quantity: 1 } },
      },
      include: { orderDetails: true },
    });
    const data = {
      promotionId: promotion.id,
      productId: product.id,
      userId: user.id,
      orderId: order.id,
      orderDetailId: order.orderDetails[0].id,
      quantity: 1,
      discountAmount: 200,
    };

    await prisma.flashSaleUserUsage.create({
      data: { promotionId: promotion.id, productId: product.id, userId: user.id, claimedUnits: 1 },
    });
    await prisma.flashSaleAllocation.create({ data });
    await expect(prisma.flashSaleAllocation.create({ data })).rejects.toMatchObject({
      code: "P2002",
    });
    await expect(prisma.product.delete({ where: { id: product.id } })).rejects.toMatchObject({
      code: "P2003",
    });
    await expect(prisma.promotion.delete({ where: { id: promotion.id } })).rejects.toMatchObject({
      code: "P2003",
    });
    await expect(
      prisma.orderDetail.delete({ where: { id: order.orderDetails[0].id } }),
    ).rejects.toMatchObject({ code: "P2003" });
  });
});
