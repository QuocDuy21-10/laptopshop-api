import { Prisma } from "@prisma/client";
import { prisma } from "config/client";
import { changeStatus, getMyOrder, placeOrder } from "modules/orders/orders.service";
import { quoteOrder } from "modules/promotions/promotions.service";
import { createProduct, createUser, ledgerMatches, putInCart, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("Flash Sale checkout", () => {
  const activeWindow = () => ({
    startsAt: new Date(Date.now() - 60_000),
    endsAt: new Date(Date.now() + 10 * 60_000),
  });

  const expectFlashSaleInvariants = async (
    promotionId: number,
    products: Array<{ id: number; initialQuantity: number }>,
    expectedFlashLineCount: number,
  ) => {
    const allocations = await prisma.flashSaleAllocation.findMany({ where: { promotionId } });
    const usages = await prisma.flashSaleUserUsage.findMany({ where: { promotionId } });
    const lines = await prisma.orderDetail.findMany({
      where: { automaticPromotionId: promotionId },
      include: {
        flashSaleAllocation: true,
        order: { select: { status: true } },
      },
    });

    expect(lines).toHaveLength(expectedFlashLineCount);
    for (const line of lines) {
      expect(line.flashSaleAllocation).not.toBeNull();
      expect(line.flashSaleAllocation?.status).toBe(
        line.order.status === "CANCELLED" ? "RELEASED" : "CLAIMED",
      );
    }
    for (const allocation of allocations.filter((row) => row.status === "CLAIMED")) {
      expect(
        usages.some(
          (usage) => usage.productId === allocation.productId && usage.userId === allocation.userId,
        ),
      ).toBe(true);
    }
    for (const product of products) {
      const quota = await prisma.flashSaleProductQuota.findUniqueOrThrow({
        where: { promotionId_productId: { promotionId, productId: product.id } },
      });
      const claimed = allocations
        .filter(
          (allocation) => allocation.productId === product.id && allocation.status === "CLAIMED",
        )
        .reduce((sum, allocation) => sum + allocation.quantity, 0);
      expect(quota.claimedUnits).toBe(claimed);
      expect(quota.claimedUnits).toBeGreaterThanOrEqual(0);
      expect(quota.claimedUnits).toBeLessThanOrEqual(quota.totalQuota);

      for (const usage of usages.filter((row) => row.productId === product.id)) {
        const userClaimed = allocations
          .filter(
            (allocation) =>
              allocation.productId === product.id &&
              allocation.userId === usage.userId &&
              allocation.status === "CLAIMED",
          )
          .reduce((sum, allocation) => sum + allocation.quantity, 0);
        expect(usage.claimedUnits).toBe(userClaimed);
        expect(usage.claimedUnits).toBeGreaterThanOrEqual(0);
        expect(usage.claimedUnits).toBeLessThanOrEqual(quota.maxUnitsPerUser);
      }

      const activeQuantity = lines
        .filter((line) => line.productId === product.id && line.order.status !== "CANCELLED")
        .reduce((sum, line) => sum + line.quantity, 0);
      await expect(
        prisma.product.findUniqueOrThrow({ where: { id: product.id } }),
      ).resolves.toMatchObject({
        quantity: product.initialQuantity - activeQuantity,
        sold: activeQuantity,
      });
      await expect(ledgerMatches(product.id)).resolves.toBe(true);
    }
  };

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
        ...activeWindow(),
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
        ...activeWindow(),
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
        ...activeWindow(),
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
        ...activeWindow(),
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

  it("rejects a quote when a price change commits while checkout waits for the product lock", async () => {
    const product = await createProduct(5, 1_000);
    const user = await createUser();
    await putInCart(user.id, product.id, 1);
    const quote = await quoteOrder(user.id);

    let signalUpdated!: () => void;
    const updated = new Promise<void>((resolve) => {
      signalUpdated = resolve;
    });
    const blocker = prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM products WHERE id = ${product.id} FOR UPDATE`);
      await tx.product.update({ where: { id: product.id }, data: { price: 1_200 } });
      signalUpdated();
      await tx.$queryRaw(Prisma.sql`SELECT SLEEP(1)`);
    });
    await updated;

    const checkout = placeOrder(user.id, "price-changed-during-lock", {
      receiverName: "R",
      receiverAddress: "A",
      receiverPhone: "0900000000",
      paymentMethod: "COD",
      pricingFingerprint: quote.pricingFingerprint,
    });
    await blocker;

    await expect(checkout).rejects.toMatchObject({ code: "PROMOTION_CHANGED" });
    await expect(
      prisma.product.findUniqueOrThrow({ where: { id: product.id } }),
    ).resolves.toMatchObject({ price: 1_200, quantity: 5, sold: 0 });
    await expect(prisma.order.count({ where: { userId: user.id } })).resolves.toBe(0);
  });

  it("preserves quota, allocation and stock invariants when checkout races cancellation", async () => {
    const product = await createProduct(3, 1_000);
    const cancellingUser = await createUser();
    const checkoutUser = await createUser();
    const promotion = await prisma.promotion.create({
      data: {
        kind: "FLASH_SALE",
        state: "ACTIVE",
        name: "Flash single race",
        discountKind: "PERCENT",
        discountValue: 20,
        ...activeWindow(),
        createdById: cancellingUser.id,
        updatedById: cancellingUser.id,
        flashSalePolicy: { create: { priority: 10, stackableWithCoupon: true } },
        flashSaleQuotas: { create: { productId: product.id, totalQuota: 2, maxUnitsPerUser: 2 } },
      },
    });
    await putInCart(cancellingUser.id, product.id, 1);
    const firstQuote = await quoteOrder(cancellingUser.id);
    const first = await placeOrder(cancellingUser.id, "flash-race-existing", {
      receiverName: "R",
      receiverAddress: "A",
      receiverPhone: "0900000000",
      pricingFingerprint: firstQuote.pricingFingerprint,
    });
    await putInCart(checkoutUser.id, product.id, 1);
    const nextQuote = await quoteOrder(checkoutUser.id);

    const results = await Promise.allSettled([
      changeStatus(first.order.id, "CANCELLED", { actorId: cancellingUser.id }),
      placeOrder(checkoutUser.id, "flash-race-next", {
        receiverName: "R",
        receiverAddress: "A",
        receiverPhone: "0900000000",
        pricingFingerprint: nextQuote.pricingFingerprint,
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: first.order.id } }),
    ).resolves.toMatchObject({ status: "CANCELLED" });
    await expect(
      prisma.order.findFirstOrThrow({ where: { userId: checkoutUser.id } }),
    ).resolves.toMatchObject({ status: "PENDING" });
    await expect(
      prisma.flashSaleAllocation.count({
        where: { promotionId: promotion.id, status: "RELEASED" },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.flashSaleAllocation.count({ where: { promotionId: promotion.id, status: "CLAIMED" } }),
    ).resolves.toBe(1);
    await expectFlashSaleInvariants(promotion.id, [{ id: product.id, initialQuantity: 3 }], 2);
  });

  it("keeps tuple ordering and invariants for opposite-order multi-product races", async () => {
    const productA = await createProduct(3, 1_000);
    const productB = await createProduct(3, 1_200);
    const cancellingUser = await createUser();
    const checkoutUser = await createUser();
    const promotion = await prisma.promotion.create({
      data: {
        kind: "FLASH_SALE",
        state: "ACTIVE",
        name: "Flash multi race",
        discountKind: "PERCENT",
        discountValue: 20,
        ...activeWindow(),
        createdById: cancellingUser.id,
        updatedById: cancellingUser.id,
        flashSalePolicy: { create: { priority: 10, stackableWithCoupon: true } },
        flashSaleQuotas: {
          create: [
            { productId: productA.id, totalQuota: 2, maxUnitsPerUser: 2 },
            { productId: productB.id, totalQuota: 2, maxUnitsPerUser: 2 },
          ],
        },
      },
    });
    await putInCart(cancellingUser.id, productA.id, 1);
    await putInCart(cancellingUser.id, productB.id, 1);
    const firstQuote = await quoteOrder(cancellingUser.id);
    const first = await placeOrder(cancellingUser.id, "flash-multi-existing", {
      receiverName: "R",
      receiverAddress: "A",
      receiverPhone: "0900000000",
      pricingFingerprint: firstQuote.pricingFingerprint,
    });
    await putInCart(checkoutUser.id, productB.id, 1);
    await putInCart(checkoutUser.id, productA.id, 1);
    const nextQuote = await quoteOrder(checkoutUser.id);

    const results = await Promise.allSettled([
      changeStatus(first.order.id, "CANCELLED", { actorId: cancellingUser.id }),
      placeOrder(checkoutUser.id, "flash-multi-next", {
        receiverName: "R",
        receiverAddress: "A",
        receiverPhone: "0900000000",
        pricingFingerprint: nextQuote.pricingFingerprint,
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: first.order.id } }),
    ).resolves.toMatchObject({ status: "CANCELLED" });
    await expect(
      prisma.order.findFirstOrThrow({ where: { userId: checkoutUser.id } }),
    ).resolves.toMatchObject({ status: "PENDING" });
    await expect(
      prisma.flashSaleAllocation.count({
        where: { promotionId: promotion.id, status: "RELEASED" },
      }),
    ).resolves.toBe(2);
    await expect(
      prisma.flashSaleAllocation.count({ where: { promotionId: promotion.id, status: "CLAIMED" } }),
    ).resolves.toBe(2);
    await expectFlashSaleInvariants(
      promotion.id,
      [
        { id: productA.id, initialQuantity: 3 },
        { id: productB.id, initialQuantity: 3 },
      ],
      4,
    );
  });
});
