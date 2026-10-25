import { prisma } from "config/client";
import { changeStatus, getMyOrder, placeOrder } from "modules/orders/orders.service";
import { quoteOrder } from "modules/promotions/promotions.service";
import { createProduct, createUser, putInCart, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("Flash Sale checkout", () => {
  it("claims the entire quoted cart quantity atomically", async () => {
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
        flashSaleQuotas: { create: { productId: product.id, totalQuota: 4, maxUnitsPerUser: 2 } },
      },
    });
    await putInCart(user.id, product.id, 2);

    const quote = await quoteOrder(user.id);
    expect(quote.lines).toMatchObject([
      expect.objectContaining({ quantity: 2, promotionKind: "FLASH_SALE" }),
    ]);
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
    ).resolves.toMatchObject({ claimedUnits: 2 });
    await expect(
      prisma.flashSaleAllocation.findMany({ where: { orderId: result.order.id } }),
    ).resolves.toMatchObject([expect.objectContaining({ quantity: 2 })]);

    await changeStatus(result.order.id, "CANCELLED", { actorId: user.id });
    await expect(
      prisma.flashSaleProductQuota.findUniqueOrThrow({
        where: { promotionId_productId: { promotionId: promotion.id, productId: product.id } },
      }),
    ).resolves.toMatchObject({ claimedUnits: 0 });
    await expect(
      prisma.flashSaleAllocation.findMany({ where: { orderId: result.order.id } }),
    ).resolves.toMatchObject([expect.objectContaining({ status: "RELEASED", quantity: 2 })]);

    await putInCart(user.id, product.id, 1);
    await expect(quoteOrder(user.id)).resolves.toMatchObject({
      lines: [expect.objectContaining({ promotionKind: "FLASH_SALE" })],
    });
  });

  it("rejects a changed winner without changing stock, quota, orders or allocations", async () => {
    const product = await createProduct(5, 1_000);
    const user = await createUser();
    const flash = await prisma.promotion.create({
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
        flashSaleQuotas: { create: { productId: product.id, totalQuota: 5, maxUnitsPerUser: 5 } },
      },
    });
    await putInCart(user.id, product.id, 1);
    const quote = await quoteOrder(user.id);
    expect(quote.lines[0]).toMatchObject({ promotionKind: "FLASH_SALE" });

    await prisma.promotion.create({
      data: {
        kind: "AUTOMATIC",
        state: "ACTIVE",
        name: "New winner",
        discountKind: "PERCENT",
        discountValue: 5,
        startsAt: new Date("2026-10-01"),
        endsAt: new Date("2026-11-01"),
        createdById: user.id,
        updatedById: user.id,
        automaticPolicy: { create: { priority: 20, stackableWithCoupon: true } },
        products: { create: { productId: product.id } },
      },
    });

    await expect(
      placeOrder(user.id, "flash-winner-changed", {
        receiverName: "R",
        receiverAddress: "A",
        receiverPhone: "0900000000",
        paymentMethod: "COD",
        pricingFingerprint: quote.pricingFingerprint,
      }),
    ).rejects.toMatchObject({ code: "PROMOTION_CHANGED" });
    await expect(
      prisma.product.findUniqueOrThrow({ where: { id: product.id } }),
    ).resolves.toMatchObject({ quantity: 5, sold: 0 });
    await expect(
      prisma.flashSaleProductQuota.findUniqueOrThrow({
        where: { promotionId_productId: { promotionId: flash.id, productId: product.id } },
      }),
    ).resolves.toMatchObject({ claimedUnits: 0 });
    await expect(prisma.order.count({ where: { userId: user.id } })).resolves.toBe(0);
    await expect(prisma.flashSaleAllocation.count({ where: { userId: user.id } })).resolves.toBe(0);
  });

  it("returns the same Flash Sale allocation metadata immediately and on subsequent reads", async () => {
    const product = await createProduct(5, 1_000);
    const user = await createUser();
    const promotion = await prisma.promotion.create({
      data: {
        kind: "FLASH_SALE",
        state: "ACTIVE",
        name: "Flash response",
        discountKind: "PERCENT",
        discountValue: 20,
        startsAt: new Date("2026-10-01"),
        endsAt: new Date("2026-11-01"),
        createdById: user.id,
        updatedById: user.id,
        flashSalePolicy: { create: { priority: 10, stackableWithCoupon: true } },
        flashSaleQuotas: { create: { productId: product.id, totalQuota: 5, maxUnitsPerUser: 5 } },
      },
    });
    await putInCart(user.id, product.id, 1);
    const quote = await quoteOrder(user.id);

    const created = await placeOrder(user.id, "flash-response", {
      receiverName: "R",
      receiverAddress: "A",
      receiverPhone: "0900000000",
      paymentMethod: "COD",
      pricingFingerprint: quote.pricingFingerprint,
    });
    const fetched = await getMyOrder(user.id, created.order.id);

    expect(created.order.items[0]).toMatchObject({
      promotionKind: "FLASH_SALE",
      flashSaleAllocation: {
        promotionId: promotion.id,
        quantity: 1,
        discountAmount: 200,
        status: "CLAIMED",
      },
    });
    expect(created.order.items[0]).toEqual(fetched.items[0]);
  });
});
