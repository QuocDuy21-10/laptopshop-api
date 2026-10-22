import { prisma } from "config/client";

export const resetDb = async () => {
  await prisma.paymentWebhookEvent.deleteMany();
  await prisma.paymentProviderCheckpoint.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.reviewImage.deleteMany();
  await prisma.reviewHelpful.deleteMany();
  await prisma.reviewReply.deleteMany();
  await prisma.review.deleteMany();
  await prisma.stockReceiptItem.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.stockReceipt.deleteMany();
  await prisma.orderStatusHistory.deleteMany();
  await prisma.promotionRedemption.deleteMany();
  await prisma.orderDetail.deleteMany();
  await prisma.order.deleteMany();
  await prisma.order.updateMany({
    where: { couponPromotionId: { not: null } },
    data: { couponPromotionId: null },
  });
  await prisma.promotionUserUsage.deleteMany();
  await prisma.promotionProduct.deleteMany();
  await prisma.couponPolicy.deleteMany();
  await prisma.automaticPromotionPolicy.deleteMany();
  await prisma.promotion.deleteMany();
  await prisma.cartDetail.deleteMany();
  await prisma.cart.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.product.deleteMany();
  await prisma.user.deleteMany();
  await prisma.role.deleteMany();
};

let seq = 0;

// call sequentially: the role upsert races on roles.name if run in parallel
export const createUser = async () => {
  const role = await prisma.role.upsert({
    where: { name: "USER" },
    create: { name: "USER" },
    update: {},
  });
  seq += 1;
  return prisma.user.create({
    data: { username: `user${seq}@test.local`, password: "x", roleId: role.id },
  });
};

export const createProduct = (quantity: number, price = 1000) =>
  prisma.product.create({
    data: {
      name: `product-${quantity}-${price}`,
      price,
      quantity,
      ...(quantity
        ? {
            stockMovements: {
              create: {
                delta: quantity,
                reason: "OPENING",
                balanceBefore: 0,
                balanceAfter: quantity,
              },
            },
          }
        : {}),
    },
  });

export const ledgerMatches = async (productId: number) => {
  const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  const sum = await prisma.stockMovement.aggregate({ where: { productId }, _sum: { delta: true } });
  return product.quantity === (sum._sum.delta ?? 0);
};

export const putInCart = (userId: number, productId: number, quantity: number) =>
  prisma.cart.upsert({
    where: { userId },
    create: { userId, cartDetails: { create: { productId, quantity } } },
    update: { cartDetails: { create: { productId, quantity } } },
  });

export const receiver = {
  receiverName: "R",
  receiverAddress: "Addr",
  receiverPhone: "0900000000",
  pricingFingerprint: "a".repeat(64),
};

export const createCompletedOrderItem = async (userId: number, productId: number) => {
  const order = await prisma.order.create({
    data: {
      totalPrice: 1000,
      subtotalPrice: 1000,
      receiverName: receiver.receiverName,
      receiverAddress: receiver.receiverAddress,
      receiverPhone: receiver.receiverPhone,
      status: "COMPLETED",
      paymentMethod: "COD",
      paymentStatus: "PAYMENT_SUCCESS",
      completedAt: new Date(),
      userId,
      orderDetails: {
        create: { productId, price: 1000, quantity: 1 },
      },
    },
    include: { orderDetails: true },
  });
  return order.orderDetails[0];
};
