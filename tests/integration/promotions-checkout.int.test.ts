import { prisma } from "config/client";
import { placeOrder } from "modules/orders/orders.service";
import { quoteOrder } from "modules/promotions/promotions.service";
import { createProduct, createUser, putInCart, receiver, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("promotion-aware checkout", () => {
  it("persists automatic and coupon discount snapshots", async () => {
    const user = await createUser();
    const product = await createProduct(2, 1_000);
    const automatic = await prisma.promotion.create({
      data: {
        kind: "AUTOMATIC",
        state: "ACTIVE",
        name: "Sale",
        discountKind: "PERCENT",
        discountValue: 10,
        startsAt: new Date("2026-10-01T00:00:00Z"),
        endsAt: new Date("2026-11-01T00:00:00Z"),
        createdById: user.id,
        updatedById: user.id,
        automaticPolicy: { create: { priority: 1, stackableWithCoupon: true } },
        products: { create: { productId: product.id } },
      },
    });
    await prisma.promotion.create({
      data: {
        kind: "COUPON",
        state: "ACTIVE",
        name: "Welcome",
        discountKind: "PERCENT",
        discountValue: 10,
        startsAt: new Date("2026-10-01T00:00:00Z"),
        endsAt: new Date("2026-11-01T00:00:00Z"),
        createdById: user.id,
        updatedById: user.id,
        couponPolicy: {
          create: { code: "WELCOME10", scope: "ORDER", maxUses: 10, maxUsesPerUser: 1 },
        },
      },
    });
    await putInCart(user.id, product.id, 1);
    const quote = await quoteOrder(user.id, "welcome10", new Date("2026-10-22T00:00:00Z"));
    const result = await placeOrder(user.id, "promotion-order", {
      ...receiver,
      couponCode: "WELCOME10",
      pricingFingerprint: quote.pricingFingerprint,
    });
    expect(result.created).toBe(true);
    expect(result.order).toMatchObject({
      subtotalPrice: 1_000,
      productDiscountAmount: 100,
      couponDiscountAmount: 90,
      totalPrice: 810,
    });
    expect(await prisma.promotionRedemption.count({ where: { orderId: result.order.id } })).toBe(1);
    expect(automatic.id).toBeGreaterThan(0);
  });

  it("creates a free order without a Payment row", async () => {
    const user = await createUser();
    const product = await createProduct(1, 1_000);
    await prisma.promotion.create({
      data: {
        kind: "COUPON",
        state: "ACTIVE",
        name: "Free",
        discountKind: "FIXED",
        discountValue: 1_000,
        startsAt: new Date("2026-10-01T00:00:00Z"),
        endsAt: new Date("2026-11-01T00:00:00Z"),
        createdById: user.id,
        updatedById: user.id,
        couponPolicy: { create: { code: "FREE1000", scope: "ORDER", maxUsesPerUser: 1 } },
      },
    });
    await putInCart(user.id, product.id, 1);
    const quote = await quoteOrder(user.id, "FREE1000", new Date("2026-10-22T00:00:00Z"));
    const result = await placeOrder(user.id, "free-order", {
      ...receiver,
      couponCode: "FREE1000",
      pricingFingerprint: quote.pricingFingerprint,
    });
    expect(result.order).toMatchObject({
      totalPrice: 0,
      paymentMethod: "FREE",
      paymentStatus: "PAYMENT_SUCCESS",
    });
    expect(await prisma.payment.count({ where: { orderId: result.order.id } })).toBe(0);
  });
});
