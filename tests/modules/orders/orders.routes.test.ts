jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import { prismaError, prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";
import { USER, cookieFor } from "../../helpers/auth";
import { createPricingFingerprint } from "modules/promotions/promotion-fingerprint";

const receiver = {
  receiverName: "R",
  receiverAddress: "Addr",
  receiverPhone: "0900000000",
  pricingFingerprint: createPricingFingerprint({
    lines: [
      {
        productId: 1,
        quantity: 2,
        listPrice: 50,
        promotion: null,
      },
      {
        productId: 2,
        quantity: 1,
        listPrice: 100,
        promotion: null,
      },
    ],
    coupon: null,
    totals: {
      subtotalPrice: 200,
      productDiscountAmount: 0,
      couponEligibleSubtotal: 0,
      couponDiscountAmount: 0,
      totalPrice: 200,
    },
  }),
};
const flashWinner = {
  id: 10,
  name: "Flash",
  kind: "FLASH_SALE" as const,
  discountKind: "PERCENT" as const,
  discountValue: 20,
  priority: 10,
  stackableWithCoupon: true,
  pricingVersion: 1,
  startsAt: new Date("2026-10-01T00:00:00.000Z"),
  endsAt: new Date("2026-11-01T00:00:00.000Z"),
  unitDiscount: 200,
  totalQuota: 10,
  claimedUnits: 0,
  remainingQuota: 10,
  maxUnitsPerUser: 5,
  showRemainingQuota: true,
  userClaimedUnits: 0,
  userRemainingQuota: 5,
};
const flashPromotionRow = {
  id: flashWinner.id,
  name: flashWinner.name,
  discountKind: flashWinner.discountKind,
  discountValue: flashWinner.discountValue,
  pricingVersion: flashWinner.pricingVersion,
  startsAt: flashWinner.startsAt,
  endsAt: flashWinner.endsAt,
  automaticPolicy: null,
  products: [],
  flashSalePolicy: {
    priority: flashWinner.priority,
    stackableWithCoupon: flashWinner.stackableWithCoupon,
    showRemainingQuota: flashWinner.showRemainingQuota,
    quotas: [
      {
        productId: 1,
        totalQuota: flashWinner.totalQuota,
        claimedUnits: flashWinner.claimedUnits,
        maxUnitsPerUser: flashWinner.maxUnitsPerUser,
        product: { price: 1_000 },
        usages: [{ userId: USER.id, claimedUnits: 0 }],
      },
    ],
  },
};
const flashFingerprint = (quantity = 1, coupon = false) =>
  createPricingFingerprint({
    lines: [{ productId: 1, quantity, listPrice: 1_000, promotion: flashWinner }],
    coupon: coupon ? { id: 20, pricingVersion: 1, scope: "ORDER", targetProductIds: [] } : null,
    totals: {
      subtotalPrice: 1_000 * quantity,
      productDiscountAmount: 200 * quantity,
      couponEligibleSubtotal: coupon ? 800 * quantity : 0,
      couponDiscountAmount: coupon ? 80 * quantity : 0,
      totalPrice: (coupon ? 720 : 800) * quantity,
    },
  });
const orderRow = (over: Record<string, unknown> = {}) => ({
  id: 50,
  userId: USER.id,
  totalPrice: 200,
  status: "PENDING",
  paymentMethod: "COD",
  paymentStatus: "PAYMENT_UNPAID",
  paymentRef: null,
  idempotencyKey: "k1",
  createdAt: new Date("2026-10-18T00:00:00Z"),
  ...receiver,
  orderDetails: [
    {
      id: 1,
      orderId: 50,
      productId: 1,
      price: 50,
      quantity: 2,
      warrantyMonthsSnapshot: 24,
      warrantyStartAt: null,
      warrantyEndAt: null,
      warrantyPolicySource: "CHECKOUT_SNAPSHOT",
      product: { name: "A", image: null },
    },
    {
      id: 2,
      orderId: 50,
      productId: 2,
      price: 100,
      quantity: 1,
      product: { name: "B", image: "b.png" },
    },
  ],
  ...over,
});
const lines = [
  { productId: 1, quantity: 2, product: { price: 50, isActive: true, warrantyMonths: 24 } },
  { productId: 2, quantity: 1, product: { price: 100, isActive: true } },
];
const post = () =>
  request(buildApp())
    .post("/api/v1/orders")
    .set("Cookie", cookieFor(USER))
    .set("Idempotency-Key", "k1");

beforeEach(() => {
  resetPrisma();
  prismaMock.$queryRaw.mockResolvedValue([
    { id: 1, price: 50, isActive: true, warrantyMonths: 24 },
    { id: 2, price: 100, isActive: true, warrantyMonths: null },
  ]);
  prismaMock.stockMovement.create.mockResolvedValue({ id: 900 });
  prismaMock.product.update.mockResolvedValue({ quantity: 2 });
  prismaMock.product.findUniqueOrThrow.mockResolvedValue({ quantity: 0 });
  prismaMock.order.findUniqueOrThrow.mockResolvedValue(orderRow());
  prismaMock.cartDetail.deleteMany.mockResolvedValue({ count: 2 });
});

describe("POST /api/v1/orders", () => {
  it("requires a pricing fingerprint for checkout", async () => {
    const res = await request(buildApp())
      .post("/api/v1/orders")
      .set("Cookie", cookieFor(USER))
      .set("Idempotency-Key", "k1")
      .send({
        receiverName: receiver.receiverName,
        receiverAddress: receiver.receiverAddress,
        receiverPhone: receiver.receiverPhone,
      });
    expect(res.status).toBe(400);
  });

  it("rejects BANK_TRANSFER while the backend feature flag is disabled", async () => {
    prismaMock.order.findUnique.mockResolvedValue(null);
    const res = await post().send({ ...receiver, paymentMethod: "BANK_TRANSFER" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PAYMENT_METHOD_UNAVAILABLE");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("requires an Idempotency-Key header", async () => {
    const res = await request(buildApp())
      .post("/api/v1/orders")
      .set("Cookie", cookieFor(USER))
      .send(receiver);
    expect(res.status).toBe(400);
  });

  it("returns 409 CART_EMPTY for an empty cart", async () => {
    prismaMock.order.findUnique.mockResolvedValue(null);
    prismaMock.cartDetail.findMany.mockResolvedValue([]);
    const res = await post().send(receiver);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CART_EMPTY");
  });

  it("returns 409 CART_EMPTY when a concurrent checkout already cleared the cart", async () => {
    prismaMock.order.findUnique.mockResolvedValue(null);
    prismaMock.cartDetail.findMany.mockResolvedValue(lines);
    prismaMock.product.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.order.create.mockResolvedValue(orderRow());
    prismaMock.cartDetail.deleteMany.mockResolvedValue({ count: 0 });
    const res = await post().send(receiver);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CART_EMPTY");
    expect(prismaMock.cart.deleteMany).not.toHaveBeenCalled();
  });

  it("creates the order with a server-side total and clears the cart", async () => {
    prismaMock.order.findUnique.mockResolvedValue(null);
    prismaMock.cartDetail.findMany.mockResolvedValue(lines);
    prismaMock.product.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.order.create.mockResolvedValue(orderRow());
    const res = await post().send({ ...receiver, totalPrice: 1 });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ id: 50, totalPrice: 200, status: "PENDING" });
    expect(res.body.data.items[1].image).toBe("/images/product/b.png");
    expect(prismaMock.cartDetail.findMany.mock.calls[0][0]).toMatchObject({
      where: { cart: { userId: USER.id } },
      orderBy: { productId: "asc" },
    });
    expect(prismaMock.product.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 1, isActive: true, quantity: { gte: 2 } },
      data: { quantity: { decrement: 2 }, sold: { increment: 2 } },
    });
    const data = prismaMock.order.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ userId: USER.id, idempotencyKey: "k1", totalPrice: 200 });
    expect(data.orderDetails.create).toEqual([
      expect.objectContaining({
        productId: 1,
        quantity: 2,
        price: 50,
        warrantyMonthsSnapshot: 24,
        warrantyPolicySource: "CHECKOUT_SNAPSHOT",
        productDiscountAmount: 0,
        couponDiscountAmount: 0,
      }),
      expect.objectContaining({
        productId: 2,
        quantity: 1,
        price: 100,
        productDiscountAmount: 0,
        couponDiscountAmount: 0,
      }),
    ]);
    expect(prismaMock.cartDetail.deleteMany).toHaveBeenCalledWith({
      where: { cart: { userId: USER.id } },
    });
    expect(prismaMock.cart.deleteMany).toHaveBeenCalledWith({ where: { userId: USER.id } });
    expect(prismaMock.orderStatusHistory.create).toHaveBeenCalledWith({
      data: { orderId: 50, fromStatus: null, toStatus: "PENDING", actorId: USER.id },
    });
    expect(prismaMock.stockMovement.create).toHaveBeenCalledWith({
      data: {
        productId: 1,
        delta: -2,
        reason: "ORDER",
        orderId: undefined,
        actorId: USER.id,
        note: undefined,
        balanceBefore: 2,
        balanceAfter: 0,
      },
    });
    expect(prismaMock.stockMovement.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [900, 900] } },
      data: { orderId: 50 },
    });
  });

  it("locks sorted product ids and reloads authoritative product values before pricing", async () => {
    const reloadedLines = [
      { productId: 1, quantity: 2 },
      { productId: 2, quantity: 1 },
    ];
    const repricedFingerprint = createPricingFingerprint({
      lines: [
        { productId: 1, quantity: 2, listPrice: 60, promotion: null },
        { productId: 2, quantity: 1, listPrice: 100, promotion: null },
      ],
      coupon: null,
      totals: {
        subtotalPrice: 220,
        productDiscountAmount: 0,
        couponEligibleSubtotal: 0,
        couponDiscountAmount: 0,
        totalPrice: 220,
      },
    });
    const reloadedOrder = orderRow({
      totalPrice: 220,
      subtotalPrice: 220,
      orderDetails: [
        {
          id: 1,
          orderId: 50,
          productId: 1,
          price: 60,
          quantity: 2,
          productDiscountAmount: 0,
          couponDiscountAmount: 0,
          warrantyMonthsSnapshot: 24,
          warrantyStartAt: null,
          warrantyEndAt: null,
          warrantyPolicySource: "CHECKOUT_SNAPSHOT",
          product: { name: "A", image: null },
          flashSaleAllocation: null,
        },
        {
          id: 2,
          orderId: 50,
          productId: 2,
          price: 100,
          quantity: 1,
          productDiscountAmount: 0,
          couponDiscountAmount: 0,
          product: { name: "B", image: null },
          flashSaleAllocation: null,
        },
      ],
    });
    prismaMock.order.findUnique.mockResolvedValue(null);
    prismaMock.cartDetail.findMany
      .mockResolvedValueOnce([{ productId: 2 }, { productId: 1 }])
      .mockResolvedValueOnce(reloadedLines);
    prismaMock.$queryRaw.mockResolvedValue([
      { id: 1, price: 60, isActive: true, warrantyMonths: 24 },
      { id: 2, price: 100, isActive: true, warrantyMonths: null },
    ]);
    prismaMock.product.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.order.create.mockResolvedValue(reloadedOrder);
    prismaMock.order.findUniqueOrThrow.mockResolvedValue(reloadedOrder);

    const res = await post().send({ ...receiver, pricingFingerprint: repricedFingerprint });

    expect(res.status).toBe(201);
    expect(prismaMock.cartDetail.findMany).toHaveBeenCalledTimes(2);
    expect(prismaMock.cartDetail.findMany.mock.calls[0][0]).toMatchObject({
      where: { cart: { userId: USER.id } },
      select: { productId: true },
      orderBy: { productId: "asc" },
    });
    expect(prismaMock.cartDetail.findMany.mock.calls[1][0]).toMatchObject({
      select: { productId: true, quantity: true },
    });
    const [lockStatement] = prismaMock.$queryRaw.mock.calls[0];
    expect(lockStatement.values).toEqual([1, 2]);
    expect(prismaMock.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.promotion.findMany.mock.invocationCallOrder[0],
    );
    expect(prismaMock.promotion.findMany.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.product.updateMany.mock.invocationCallOrder[0],
    );
    expect(prismaMock.order.create.mock.calls[0][0].data.orderDetails.create[0]).toMatchObject({
      productId: 1,
      price: 60,
    });
  });

  it("rejects a changed resolved winner before quota, stock or order writes", async () => {
    prismaMock.order.findUnique.mockResolvedValue(null);
    prismaMock.cartDetail.findMany.mockResolvedValue([
      {
        productId: 1,
        quantity: 1,
        product: { price: 1_000, isActive: true, warrantyMonths: 24 },
      },
    ]);
    prismaMock.$queryRaw.mockResolvedValue([
      { id: 1, price: 1_000, isActive: true, warrantyMonths: 24 },
    ]);
    prismaMock.promotion.findMany.mockResolvedValue([flashPromotionRow]);

    const res = await post().send({
      ...receiver,
      pricingFingerprint: createPricingFingerprint({
        lines: [{ productId: 1, quantity: 1, listPrice: 1_000, promotion: null }],
        coupon: null,
        totals: {
          subtotalPrice: 1_000,
          productDiscountAmount: 0,
          couponEligibleSubtotal: 0,
          couponDiscountAmount: 0,
          totalPrice: 1_000,
        },
      }),
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PROMOTION_CHANGED");
    expect(prismaMock.flashSaleProductQuota.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.product.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.order.create).not.toHaveBeenCalled();
  });

  it("claims coupon before locked Flash Sale quota and returns the persisted allocation", async () => {
    const flashLine = {
      productId: 1,
      quantity: 1,
      product: { price: 1_000, isActive: true, warrantyMonths: 24 },
    };
    const staleCreated = orderRow({
      totalPrice: 720,
      subtotalPrice: 1_000,
      productDiscountAmount: 200,
      couponEligibleSubtotal: 800,
      couponDiscountAmount: 80,
      couponCode: "SAVE10",
      orderDetails: [
        {
          id: 11,
          orderId: 50,
          productId: 1,
          price: 1_000,
          quantity: 1,
          productDiscountAmount: 200,
          couponDiscountAmount: 80,
          automaticPromotionId: 10,
          automaticPromotionName: "Flash",
          warrantyMonthsSnapshot: 24,
          warrantyStartAt: null,
          warrantyEndAt: null,
          warrantyPolicySource: "CHECKOUT_SNAPSHOT",
          product: { name: "A", image: null },
          flashSaleAllocation: null,
        },
      ],
    });
    const persisted = orderRow({
      ...staleCreated,
      orderDetails: [
        {
          ...staleCreated.orderDetails[0],
          flashSaleAllocation: {
            promotionId: 10,
            quantity: 1,
            discountAmount: 200,
            status: "CLAIMED",
          },
        },
      ],
    });
    prismaMock.order.findUnique.mockResolvedValue(null);
    prismaMock.cartDetail.findMany.mockResolvedValue([flashLine]);
    prismaMock.promotion.findMany.mockResolvedValue([flashPromotionRow]);
    prismaMock.promotion.findFirst.mockResolvedValue({
      id: 20,
      state: "ACTIVE",
      name: "Save 10",
      discountKind: "PERCENT",
      discountValue: 10,
      pricingVersion: 1,
      startsAt: flashWinner.startsAt,
      endsAt: flashWinner.endsAt,
      couponPolicy: {
        code: "SAVE10",
        scope: "ORDER",
        minOrderValue: 0,
        maxDiscount: null,
      },
      products: [],
    });
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ id: 1, price: 1_000, isActive: true, warrantyMonths: 24 }])
      .mockResolvedValueOnce([
        {
          id: 10,
          state: "ACTIVE",
          startsAt: flashWinner.startsAt,
          endsAt: flashWinner.endsAt,
          pricingVersion: 1,
        },
      ]);
    prismaMock.couponPolicy.findUnique.mockResolvedValue({
      promotionId: 20,
      maxUses: 10,
      usedCount: 0,
      maxUsesPerUser: 2,
    });
    prismaMock.couponPolicy.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.promotionUserUsage.findUnique.mockResolvedValue(null);
    prismaMock.promotionUserUsage.create.mockResolvedValue({ usedCount: 1 });
    prismaMock.flashSaleProductQuota.findUnique.mockResolvedValue({
      totalQuota: 10,
      claimedUnits: 0,
      maxUnitsPerUser: 5,
    });
    prismaMock.flashSaleProductQuota.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.flashSaleUserUsage.upsert.mockResolvedValue({ claimedUnits: 0 });
    prismaMock.flashSaleUserUsage.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.product.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.order.create.mockResolvedValue(staleCreated);
    prismaMock.order.findUniqueOrThrow.mockResolvedValue(persisted);

    const res = await post().send({
      ...receiver,
      couponCode: "SAVE10",
      pricingFingerprint: flashFingerprint(1, true),
    });

    expect(res.status).toBe(201);
    expect(prismaMock.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.couponPolicy.findUnique.mock.invocationCallOrder[0],
    );
    expect(prismaMock.couponPolicy.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.$queryRaw.mock.invocationCallOrder[1],
    );
    expect(prismaMock.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      prismaMock.flashSaleProductQuota.findUnique.mock.invocationCallOrder[0],
    );
    expect(prismaMock.flashSaleProductQuota.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.product.updateMany.mock.invocationCallOrder[0],
    );
    expect(prismaMock.order.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 50 } }),
    );
    expect(res.body.data.items[0]).toMatchObject({
      promotionKind: "FLASH_SALE",
      flashSaleAllocation: {
        promotionId: 10,
        quantity: 1,
        discountAmount: 200,
        status: "CLAIMED",
      },
    });

    prismaMock.order.findFirst.mockResolvedValue(persisted);
    const getRes = await request(buildApp())
      .get("/api/v1/orders/me/50")
      .set("Cookie", cookieFor(USER));
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.items[0]).toEqual(res.body.data.items[0]);
  });

  const productCoupon = (couponPolicy: Record<string, unknown> = {}) => ({
    id: 20,
    state: "ACTIVE",
    name: "Product only",
    discountKind: "FIXED",
    discountValue: 10,
    pricingVersion: 1,
    startsAt: new Date("2026-01-01T00:00:00Z"),
    endsAt: new Date("2099-01-01T00:00:00Z"),
    couponPolicy: {
      code: "AONLY",
      scope: "PRODUCT",
      minOrderValue: 0,
      maxDiscount: null,
      maxUses: null,
      usedCount: 0,
      maxUsesPerUser: 1,
      ...couponPolicy,
    },
    products: [{ productId: 99 }],
  });

  it("rejects a coupon that discounts nothing before usage, stock or order writes", async () => {
    prismaMock.order.findUnique.mockResolvedValue(null);
    prismaMock.cartDetail.findMany.mockResolvedValue(lines);
    prismaMock.promotion.findFirst.mockResolvedValue(productCoupon());
    const res = await post().send({ ...receiver, couponCode: "AONLY" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("COUPON_NOT_APPLICABLE");
    expect(prismaMock.couponPolicy.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.product.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.order.create).not.toHaveBeenCalled();
  });

  it("rejects an exhausted coupon before stock or order writes", async () => {
    prismaMock.order.findUnique.mockResolvedValue(null);
    prismaMock.cartDetail.findMany.mockResolvedValue(lines);
    prismaMock.promotion.findFirst.mockResolvedValue(productCoupon({ maxUses: 1, usedCount: 1 }));
    const res = await post().send({ ...receiver, couponCode: "AONLY" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PROMOTION_USAGE_LIMIT");
    expect(prismaMock.product.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.order.create).not.toHaveBeenCalled();
  });

  it("retries only the transaction operation after a deadlock", async () => {
    prismaMock.order.findUnique.mockResolvedValue(null);
    prismaMock.cartDetail.findMany.mockResolvedValue(lines);
    prismaMock.product.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.order.create.mockResolvedValue(orderRow());
    prismaMock.$transaction
      .mockRejectedValueOnce(prismaError("P2034"))
      .mockImplementationOnce(async (operation: (tx: unknown) => unknown) => operation(prismaMock));

    const res = await post().send(receiver);

    expect(res.status).toBe(201);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
  });

  it("returns 409 PRODUCT_UNAVAILABLE and creates nothing when a line is hidden", async () => {
    prismaMock.order.findUnique.mockResolvedValue(null);
    prismaMock.cartDetail.findMany.mockResolvedValue([
      lines[0],
      { ...lines[1], product: { price: 100, isActive: false } },
    ]);
    prismaMock.$queryRaw.mockResolvedValue([
      { id: 1, price: 50, isActive: true, warrantyMonths: 24 },
      { id: 2, price: 100, isActive: false, warrantyMonths: null },
    ]);
    prismaMock.product.updateMany.mockResolvedValue({ count: 1 });
    const res = await post().send(receiver);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: "PRODUCT_UNAVAILABLE",
      details: { productId: 2 },
    });
    expect(prismaMock.order.create).not.toHaveBeenCalled();
  });

  it("returns 409 OUT_OF_STOCK and creates nothing when stock is short", async () => {
    prismaMock.order.findUnique.mockResolvedValue(null);
    prismaMock.cartDetail.findMany.mockResolvedValue(lines);
    prismaMock.order.create.mockResolvedValue(orderRow());
    prismaMock.product.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const res = await post().send(receiver);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "OUT_OF_STOCK", details: { productId: 2 } });
    expect(prismaMock.cartDetail.deleteMany).not.toHaveBeenCalled();
  });

  it("replays an existing order for a reused key", async () => {
    prismaMock.order.findUnique.mockResolvedValue(orderRow());
    const res = await post().send(receiver);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(50);
    expect(prismaMock.order.findUnique.mock.calls[0][0].where).toEqual({
      userId_idempotencyKey: { userId: USER.id, idempotencyKey: "k1" },
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("replays the winner's order when a concurrent duplicate loses the race", async () => {
    prismaMock.order.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(orderRow());
    prismaMock.$transaction.mockRejectedValue(prismaError("P2002"));
    const res = await post().send(receiver);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(50);
  });

  it("rejects a concurrent winner created from a different payload", async () => {
    prismaMock.order.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(orderRow({ requestHash: "f".repeat(64) }));
    prismaMock.$transaction.mockRejectedValue(prismaError("P2002"));

    const res = await post().send(receiver);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });
});

describe("GET /api/v1/orders/me", () => {
  it("lists only the caller's orders", async () => {
    prismaMock.order.count.mockResolvedValue(1);
    prismaMock.order.findMany.mockResolvedValue([orderRow()]);
    const res = await request(buildApp()).get("/api/v1/orders/me").set("Cookie", cookieFor(USER));
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
    expect(prismaMock.order.findMany.mock.calls[0][0].where).toEqual({ userId: USER.id });
  });

  it("returns 404 for someone else's order", async () => {
    prismaMock.order.findFirst.mockResolvedValue(null);
    const res = await request(buildApp())
      .get("/api/v1/orders/me/50")
      .set("Cookie", cookieFor(USER));
    expect(res.status).toBe(404);
    expect(prismaMock.order.findFirst.mock.calls[0][0].where).toEqual({
      id: 50,
      userId: USER.id,
    });
  });
});

describe("POST /api/v1/orders/me/:id/cancel", () => {
  const cancel = () =>
    request(buildApp()).post("/api/v1/orders/me/50/cancel").set("Cookie", cookieFor(USER));

  it("refuses to cancel a shipping order", async () => {
    prismaMock.order.findFirst.mockResolvedValue({ status: "SHIPPING" });
    const res = await cancel();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_STATUS_TRANSITION");
  });

  it("cancels a pending order and restocks each line", async () => {
    prismaMock.order.findFirst.mockResolvedValue({ status: "PENDING" });
    prismaMock.order.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.orderDetail.findMany.mockResolvedValue([
      { productId: 1, quantity: 2 },
      { productId: 2, quantity: 1 },
    ]);
    prismaMock.order.findUniqueOrThrow.mockResolvedValue(orderRow({ status: "CANCELLED" }));
    const res = await cancel();
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("CANCELLED");
    expect(prismaMock.order.updateMany).toHaveBeenCalledWith({
      where: { id: 50, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    expect(prismaMock.product.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { quantity: { increment: 2 }, sold: { decrement: 2 } },
    });
    expect(prismaMock.orderStatusHistory.create).toHaveBeenCalledWith({
      data: { orderId: 50, fromStatus: "PENDING", toStatus: "CANCELLED", actorId: USER.id },
    });
    expect(prismaMock.stockMovement.create).toHaveBeenCalledWith({
      data: {
        productId: 1,
        delta: 2,
        reason: "ORDER_CANCEL",
        orderId: 50,
        actorId: USER.id,
        note: undefined,
        balanceBefore: 0,
        balanceAfter: 2,
      },
    });
  });

  it("restocks sorted products before releasing Flash Sale quota", async () => {
    prismaMock.order.findFirst.mockResolvedValue({ status: "PENDING" });
    prismaMock.order.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.orderDetail.findMany.mockResolvedValue([
      { productId: 1, quantity: 2 },
      { productId: 2, quantity: 1 },
    ]);
    prismaMock.flashSaleAllocation.findMany.mockResolvedValue([
      { id: 9, promotionId: 10, productId: 1, userId: USER.id, quantity: 2 },
    ]);
    prismaMock.flashSaleAllocation.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.flashSaleProductQuota.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.flashSaleUserUsage.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.order.findUniqueOrThrow.mockResolvedValue(orderRow({ status: "CANCELLED" }));

    const res = await cancel();

    expect(res.status).toBe(200);
    expect(prismaMock.orderDetail.findMany).toHaveBeenCalledWith({
      where: { orderId: 50 },
      orderBy: { productId: "asc" },
    });
    expect(prismaMock.product.update.mock.invocationCallOrder.at(-1)).toBeLessThan(
      prismaMock.flashSaleAllocation.updateMany.mock.invocationCallOrder[0],
    );
  });

  it("retries the complete cancellation transaction after a deadlock", async () => {
    prismaMock.order.findFirst.mockResolvedValue({ status: "PENDING" });
    prismaMock.order.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.orderDetail.findMany.mockResolvedValue([]);
    prismaMock.order.findUniqueOrThrow.mockResolvedValue(orderRow({ status: "CANCELLED" }));
    prismaMock.$transaction
      .mockRejectedValueOnce(prismaError("P2034"))
      .mockImplementationOnce(async (operation: (tx: unknown) => unknown) => operation(prismaMock));

    const res = await cancel();

    expect(res.status).toBe(200);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
  });

  it("returns 409 when another request changed the status first", async () => {
    prismaMock.order.findFirst.mockResolvedValue({ status: "PENDING" });
    prismaMock.order.updateMany.mockResolvedValue({ count: 0 });
    const res = await cancel();
    expect(res.status).toBe(409);
    expect(prismaMock.product.update).not.toHaveBeenCalled();
    expect(prismaMock.orderStatusHistory.create).not.toHaveBeenCalled();
  });

  it("does not allow a customer to cancel a paid bank-transfer order", async () => {
    prismaMock.order.findFirst.mockResolvedValue({
      status: "PENDING",
      paymentMethod: "BANK_TRANSFER",
      paymentStatus: "PAYMENT_SUCCESS",
    });
    const res = await cancel();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PAID_ORDER_CANNOT_CANCEL");
    expect(prismaMock.order.updateMany).not.toHaveBeenCalled();
  });

  it("does not allow a customer to cancel a bank-transfer order under verification", async () => {
    prismaMock.order.findFirst.mockResolvedValue({
      status: "PENDING",
      paymentMethod: "BANK_TRANSFER",
      paymentStatus: "PAYMENT_UNPAID",
      payment: { status: "VERIFYING" },
    });
    const res = await cancel();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PAYMENT_VERIFICATION_IN_PROGRESS");
    expect(prismaMock.order.updateMany).not.toHaveBeenCalled();
  });

  it("does not release stock when payment success wins after the initial read", async () => {
    prismaMock.order.findFirst.mockResolvedValue({
      status: "PENDING",
      paymentMethod: "BANK_TRANSFER",
      paymentStatus: "PAYMENT_UNPAID",
      payment: { status: "PENDING" },
    });
    prismaMock.order.updateMany.mockResolvedValue({ count: 0 });
    const res = await cancel();
    expect(res.status).toBe(409);
    expect(prismaMock.product.update).not.toHaveBeenCalled();
    expect(prismaMock.payment.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          paymentStatus: "PAYMENT_UNPAID",
          payment: { status: { in: ["PENDING"] } },
        }),
      }),
    );
  });
});
