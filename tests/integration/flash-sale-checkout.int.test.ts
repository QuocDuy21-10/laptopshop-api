import { prisma } from "config/client";
import { changeStatus, placeOrder } from "modules/orders/orders.service";
import { quoteOrder } from "modules/promotions/promotions.service";
import { createProduct, createUser, putInCart, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("Flash Sale checkout", () => {
  it("claims quota atomically, records the allocation and enforces the user limit on the next quote", async () => {
    const product = await createProduct(5, 1_000);
    const user = await createUser();
    const promotion = await prisma.promotion.create({
      data: {
        kind: "FLASH_SALE",
        state: "ACTIVE",
        name: "Flash",
        discountKind: "PERCENT",
        discountValue: 20,
        startsAt: new Date("2026-10-01"),
        endsAt: new Date("2026-11-01"),
        createdById: user.id,
        updatedById: user.id,
        flashSalePolicy: { create: { priority: 10, stackableWithCoupon: true } },
        flashSaleQuotas: { create: { productId: product.id, totalQuota: 2, maxUnitsPerUser: 1 } },
      },
    });
    await putInCart(user.id, product.id, 1);

    const quote = await quoteOrder(user.id);
    const result = await placeOrder(user.id, "flash-1", {
      receiverName: "R",
      receiverAddress: "A",
      receiverPhone: "0900000000",
      paymentMethod: "COD",
      pricingFingerprint: quote.pricingFingerprint,
    });

    expect(result.created).toBe(true);
    await expect(
      prisma.flashSaleProductQuota.findUniqueOrThrow({
        where: { promotionId_productId: { promotionId: promotion.id, productId: product.id } },
      }),
    ).resolves.toMatchObject({ claimedUnits: 1 });
    await expect(
      prisma.flashSaleAllocation.findMany({ where: { orderId: result.order.id } }),
    ).resolves.toHaveLength(1);

    await changeStatus(result.order.id, "CANCELLED", { actorId: user.id });
    await expect(
      prisma.flashSaleProductQuota.findUniqueOrThrow({
        where: { promotionId_productId: { promotionId: promotion.id, productId: product.id } },
      }),
    ).resolves.toMatchObject({ claimedUnits: 0 });
    await expect(
      prisma.flashSaleAllocation.findMany({ where: { orderId: result.order.id } }),
    ).resolves.toMatchObject([expect.objectContaining({ status: "RELEASED", quantity: 1 })]);

    await putInCart(user.id, product.id, 1);
    await expect(quoteOrder(user.id)).resolves.toMatchObject({
      lines: [expect.objectContaining({ promotionKind: "FLASH_SALE" })],
    });
  });
});
