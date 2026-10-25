import { Prisma } from "@prisma/client";
import { prisma } from "config/client";
import { env } from "config/env";
import { AppError, notFound } from "lib/errors";
import { pageArgs, pageMeta, PageQuery } from "lib/http";
import { withPrismaTransactionRetry } from "lib/prisma-retry";
import { assertExportSize, CsvColumn, toCsv } from "lib/csv";
import { assertDayRange, createdAtRange, formatShopDateTime } from "lib/shop-time";
import { productUnavailable } from "modules/cart/cart.service";
import { moveStock } from "modules/inventory/inventory.service";
import { warrantySnapshotForCompletion } from "modules/orders/order-warranty";
import { lockProductRows } from "modules/orders/order-locks";
import {
  adminOrderDetailInclude,
  adminOrderInclude,
  orderInclude,
  toAdminOrderDetailDto,
  toAdminOrderDto,
  toOrderDto,
} from "modules/orders/orders.mapper";
import {
  AdminExportOrdersQuery,
  AdminListOrdersQuery,
  PlaceOrderBody,
} from "modules/orders/orders.schema";
import {
  canTransition,
  invalidTransition,
  ORDER_STATUS,
  OrderStatus,
  PAYMENT_STATUS,
} from "modules/orders/order-status";
import { createTransferCode } from "modules/payments/payment-reference";
import { calculatePromotionPricing } from "modules/promotions/promotion-pricing";
import {
  createCheckoutRequestHash,
  createPricingFingerprint,
} from "modules/promotions/promotion-fingerprint";
import { resolveProductPromotions } from "modules/promotions/promotion-resolver";
import { resolveCoupon } from "modules/promotions/promotions.service";
import { claimCouponUsage, recordCouponRedemption } from "modules/promotions/promotion-usage";
import {
  claimFlashSaleQuotas,
  recordFlashSaleAllocations,
} from "modules/promotions/flash-sale-quota";
import { cancelOrder } from "modules/orders/order-cancellation.service";
import type { PricingLineInput } from "modules/promotions/promotions.types";

const findByKey = (userId: number, idempotencyKey: string) =>
  prisma.order.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey } },
    include: orderInclude,
  });

const assertReplayMatches = (
  existing: NonNullable<Awaited<ReturnType<typeof findByKey>>>,
  requestHash: string,
) => {
  if (existing.requestHash && existing.requestHash !== requestHash) {
    throw new AppError(
      "Idempotency key was reused with a different request",
      409,
      "IDEMPOTENCY_KEY_REUSED",
    );
  }
};

export const placeOrder = async (userId: number, key: string, receiver: PlaceOrderBody) => {
  const paymentMethod = receiver.paymentMethod ?? "COD";
  const requestHash = createCheckoutRequestHash({
    receiverName: receiver.receiverName,
    receiverAddress: receiver.receiverAddress,
    receiverPhone: receiver.receiverPhone,
    paymentMethod,
    couponCode: receiver.couponCode,
    pricingFingerprint: receiver.pricingFingerprint,
  });
  const existing = await findByKey(userId, key);
  if (existing) {
    assertReplayMatches(existing, requestHash);
    return { order: toOrderDto(existing), created: false };
  }
  if (paymentMethod === "BANK_TRANSFER" && !env.BANK_TRANSFER_ENABLED) {
    throw new AppError("Bank transfer is unavailable", 409, "PAYMENT_METHOD_UNAVAILABLE");
  }
  try {
    const result = await withPrismaTransactionRetry(
      () =>
        prisma.$transaction(async (tx) => {
          const replay = await tx.order.findUnique({
            where: { userId_idempotencyKey: { userId, idempotencyKey: key } },
            include: orderInclude,
          });
          if (replay) {
            assertReplayMatches(replay, requestHash);
            return { row: replay, created: false };
          }

          const cartProductIds = await tx.cartDetail.findMany({
            where: { cart: { userId } },
            select: { productId: true },
            orderBy: { productId: "asc" },
          });
          if (cartProductIds.length === 0) throw new AppError("Cart is empty", 409, "CART_EMPTY");
          await lockProductRows(
            tx,
            cartProductIds.map((line) => line.productId),
          );

          const now = new Date();
          const lines = await tx.cartDetail.findMany({
            where: { cart: { userId } },
            include: {
              product: { select: { price: true, isActive: true, warrantyMonths: true } },
            },
            orderBy: { productId: "asc" },
          });
          if (lines.length === 0) throw new AppError("Cart is empty", 409, "CART_EMPTY");
          for (const line of lines) {
            if (!line.product.isActive) throw productUnavailable(line.productId);
          }
          const promotions = await resolveProductPromotions(
            tx,
            lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
            { now, userId, eligibilityMode: "EXACT" },
          );
          const pricingLines: PricingLineInput[] = lines.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            listPrice: line.product.price,
            promotion: promotions.get(line.productId)?.winner ?? null,
            promotionFallback: promotions.get(line.productId)?.fallback ?? null,
          }));
          const coupon = receiver.couponCode
            ? await resolveCoupon(tx, receiver.couponCode, userId, pricingLines, now)
            : null;
          const pricing = calculatePromotionPricing({ lines: pricingLines, coupon });
          const minimumBase =
            coupon?.scope === "PRODUCT"
              ? pricing.couponEligibleSubtotal
              : pricing.subtotalPrice - pricing.productDiscountAmount;
          if (coupon && minimumBase < coupon.minOrderValue) {
            throw new AppError("Minimum order value is not met", 409, "MIN_ORDER_NOT_MET");
          }
          const fingerprint = createPricingFingerprint({
            lines: pricingLines.map((line) => ({
              productId: line.productId,
              quantity: line.quantity,
              listPrice: line.listPrice,
              promotion: line.promotion,
            })),
            coupon: coupon
              ? {
                  id: coupon.id,
                  pricingVersion: coupon.pricingVersion,
                  scope: coupon.scope,
                  targetProductIds: coupon.targetProductIds,
                }
              : null,
            totals: pricing,
          });
          if ((coupon || promotions.size > 0) && fingerprint !== receiver.pricingFingerprint) {
            throw new AppError("Promotion pricing changed", 409, "PROMOTION_CHANGED");
          }
          const flashClaims = pricingLines.flatMap((line) => {
            const promotion = line.promotion;
            return promotion?.kind === "FLASH_SALE"
              ? [
                  {
                    promotionId: promotion.id,
                    productId: line.productId,
                    quantity: line.quantity,
                    pricingVersion: promotion.pricingVersion,
                  },
                ]
              : [];
          });
          if (coupon) await claimCouponUsage(tx, { promotionId: coupon.id, userId, now });
          if (flashClaims.length > 0)
            await claimFlashSaleQuotas(tx, { userId, now, claims: flashClaims });
          const movements = [];
          for (const line of lines) {
            movements.push(
              await moveStock(tx, {
                productId: line.productId,
                delta: -line.quantity,
                reason: "ORDER",
                actorId: userId,
                onlyActive: true,
              }),
            );
          }
          const totalPrice = pricing.totalPrice;
          const pricedByProduct = new Map(pricing.lines.map((line) => [line.productId, line]));
          const payment =
            paymentMethod === "BANK_TRANSFER" && totalPrice > 0
              ? (() => {
                  const expiresAt = new Date(Date.now() + env.PAYMENT_TTL_MINUTES * 60_000);
                  return {
                    provider: env.PAYMENT_PROVIDER,
                    providerMode: env.PAYMENT_PROVIDER === "fake" ? "test" : env.SEPAY_MODE,
                    method: "BANK_TRANSFER",
                    status: "PENDING",
                    amount: totalPrice,
                    currency: "VND",
                    transferCode: createTransferCode(),
                    bankCode: env.SEPAY_BANK_CODE!,
                    accountNumber: env.SEPAY_ACCOUNT_NUMBER!,
                    accountName: env.SEPAY_ACCOUNT_NAME!,
                    expiresAt,
                    cancelAfter: new Date(expiresAt.getTime() + env.PAYMENT_GRACE_SECONDS * 1000),
                    reviewAfter: new Date(
                      expiresAt.getTime() + env.PAYMENT_MAX_AUTO_HOLD_MINUTES * 60_000,
                    ),
                  };
                })()
              : undefined;
          const orderData: Prisma.OrderUncheckedCreateInput = {
            userId,
            idempotencyKey: key,
            totalPrice,
            subtotalPrice: pricing.subtotalPrice,
            productDiscountAmount: pricing.productDiscountAmount,
            couponEligibleSubtotal: pricing.couponEligibleSubtotal,
            couponDiscountAmount: pricing.couponDiscountAmount,
            couponPromotionId: coupon?.id,
            couponCode: coupon?.code,
            couponName: coupon?.name,
            requestHash,
            receiverName: receiver.receiverName,
            receiverAddress: receiver.receiverAddress,
            receiverPhone: receiver.receiverPhone,
            status: ORDER_STATUS.PENDING,
            paymentMethod: totalPrice === 0 ? "FREE" : paymentMethod,
            paymentStatus: totalPrice === 0 ? PAYMENT_STATUS.SUCCESS : PAYMENT_STATUS.UNPAID,
            ...(payment ? { payment: { create: payment } } : {}),
            orderDetails: {
              create: lines.map((l) => ({
                productId: l.productId,
                quantity: l.quantity,
                price: l.product.price,
                productDiscountAmount: pricedByProduct.get(l.productId)!.productDiscountAmount,
                couponDiscountAmount: pricedByProduct.get(l.productId)!.couponDiscountAmount,
                automaticPromotionId: pricedByProduct.get(l.productId)!.automaticPromotion?.id,
                automaticPromotionName: pricedByProduct.get(l.productId)!.automaticPromotion?.name,
                warrantyMonthsSnapshot: l.product.warrantyMonths,
                warrantyPolicySource: "CHECKOUT_SNAPSHOT",
              })),
            },
          };
          const created = await tx.order.create({
            data: orderData,
            include: orderInclude,
          });
          if (coupon) {
            await recordCouponRedemption(tx, {
              promotionId: coupon.id,
              userId,
              orderId: created.id,
              discountAmount: pricing.couponDiscountAmount,
            });
          }
          if (flashClaims.length > 0) {
            await recordFlashSaleAllocations(tx, {
              userId,
              orderId: created.id,
              lines: created.orderDetails.flatMap((detail) => {
                const priced = pricedByProduct.get(detail.productId)!;
                return priced.promotionKind === "FLASH_SALE" && priced.automaticPromotion
                  ? [
                      {
                        orderDetailId: detail.id,
                        promotionId: priced.automaticPromotion.id,
                        productId: detail.productId,
                        quantity: detail.quantity,
                        discountAmount: priced.productDiscountAmount,
                      },
                    ]
                  : [];
              }),
            });
          }
          await tx.orderStatusHistory.create({
            data: {
              orderId: created.id,
              fromStatus: null,
              toStatus: ORDER_STATUS.PENDING,
              actorId: userId,
            },
          });
          // link the ledger rows to the order now that it exists
          await tx.stockMovement.updateMany({
            where: { id: { in: movements.map((m) => m.id) } },
            data: { orderId: created.id },
          });
          const persisted = await tx.order.findUniqueOrThrow({
            where: { id: created.id },
            include: orderInclude,
          });
          await tx.cartDetail.deleteMany({ where: { cart: { userId } } });
          await tx.cart.deleteMany({ where: { userId } });
          return { row: persisted, created: true };
        }),
      3,
    );
    return { order: toOrderDto(result.row), created: result.created };
  } catch (e) {
    if (e instanceof AppError && e.code === "IDEMPOTENCY_KEY_REUSED") throw e;
    // a concurrent request with the same key may have won (P2002, OUT_OF_STOCK or CART_EMPTY here)
    const winner = await findByKey(userId, key);
    if (winner) return { order: toOrderDto(winner), created: false };
    throw e;
  }
};

export const listMyOrders = async (userId: number, q: PageQuery) => {
  const where = { userId };
  const [total, rows] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      include: orderInclude,
      orderBy: { id: "desc" },
      ...pageArgs(q),
    }),
  ]);
  return { items: rows.map(toOrderDto), meta: pageMeta(q, total) };
};

export const getMyOrder = async (userId: number, id: number) => {
  const order = await prisma.order.findFirst({ where: { id, userId }, include: orderInclude });
  if (!order) throw notFound("Order");
  return toOrderDto(order);
};

export const changeStatus = async (
  orderId: number,
  to: OrderStatus,
  scope: { actorId?: number; userId?: number; from?: OrderStatus[]; reason?: string },
) =>
  prisma.$transaction(async (tx) => {
    if (to === ORDER_STATUS.CANCELLED) {
      return cancelOrder(tx, {
        orderId,
        actorId: scope.actorId,
        userId: scope.userId,
        from: scope.from ?? ["PENDING", "SHIPPING"],
        reason: scope.reason,
        paymentDisposition: "CANCEL",
        now: new Date(),
      });
    }
    const order = await tx.order.findFirst({
      where: { id: orderId, ...(scope.userId ? { userId: scope.userId } : {}) },
      select: {
        status: true,
        paymentMethod: true,
        paymentStatus: true,
        orderDetails: { select: { id: true, warrantyMonthsSnapshot: true } },
      },
    });
    if (!order) throw notFound("Order");
    const allowedFrom = !scope.from || scope.from.includes(order.status as OrderStatus);
    if (!allowedFrom || !canTransition(order.status, to)) throw invalidTransition(order.status, to);
    if (
      order.paymentMethod === "BANK_TRANSFER" &&
      (to === ORDER_STATUS.SHIPPING || to === ORDER_STATUS.COMPLETED) &&
      order.paymentStatus !== PAYMENT_STATUS.SUCCESS
    ) {
      throw new AppError("Payment is required before fulfillment", 409, "PAYMENT_REQUIRED");
    }
    const completedAt = to === ORDER_STATUS.COMPLETED ? new Date() : null;
    // conditional on the status we read, so two concurrent changes cannot both apply (no double restock)
    const { count } = await tx.order.updateMany({
      where: { id: orderId, status: order.status },
      data: {
        status: to,
        ...(to === ORDER_STATUS.COMPLETED && order.paymentMethod !== "BANK_TRANSFER"
          ? { paymentStatus: PAYMENT_STATUS.SUCCESS, completedAt }
          : to === ORDER_STATUS.COMPLETED
            ? { completedAt }
            : {}),
      },
    });
    if (count === 0) throw invalidTransition(order.status, to);
    if (completedAt) {
      for (const detail of order.orderDetails ?? []) {
        const warranty = warrantySnapshotForCompletion({
          months: detail.warrantyMonthsSnapshot,
          completedAt,
        });
        await tx.orderDetail.update({
          where: { id: detail.id },
          data: { warrantyStartAt: warranty.startAt, warrantyEndAt: warranty.endAt },
        });
      }
    }
    // same transaction as the status change, so history never misses or invents a transition
    await tx.orderStatusHistory.create({
      data: {
        orderId,
        fromStatus: order.status,
        toStatus: to,
        actorId: scope.actorId,
        ...(scope.reason ? { reason: scope.reason } : {}),
      },
    });
    return toOrderDto(
      await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude }),
    );
  });

export const cancelMyOrder = (userId: number, orderId: number) =>
  changeStatus(orderId, ORDER_STATUS.CANCELLED, {
    actorId: userId,
    userId,
    from: [ORDER_STATUS.PENDING],
  });

export const adminOrderWhere = (q: AdminExportOrdersQuery): Prisma.OrderWhereInput => {
  assertDayRange(q.from, q.to);
  // up to 9 digits always fits the INT id column; longer digit strings are phone numbers
  const id = q.q && /^\d{1,9}$/.test(q.q) ? Number(q.q) : undefined;
  const search = q.q
    ? id
      ? [{ id }, { receiverPhone: { contains: q.q } }]
      : [{ receiverName: { contains: q.q } }, { receiverPhone: { contains: q.q } }]
    : undefined;
  return {
    ...(q.status ? { status: q.status } : {}),
    ...(q.userId ? { userId: q.userId } : {}),
    ...(search ? { OR: search } : {}),
    ...createdAtRange(q.from, q.to),
  };
};

export const listAllOrders = async (q: AdminListOrdersQuery) => {
  const where = adminOrderWhere(q);
  const [total, rows] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      include: adminOrderInclude,
      orderBy: { id: "desc" },
      ...pageArgs(q),
    }),
  ]);
  return { items: rows.map(toAdminOrderDto), meta: pageMeta(q, total) };
};

export const getAnyOrder = async (id: number) => {
  const order = await prisma.order.findUnique({ where: { id }, include: adminOrderDetailInclude });
  if (!order) throw notFound("Order");
  return toAdminOrderDetailDto(order);
};

type ExportOrderRow = Prisma.OrderGetPayload<{
  include: { user: { select: { username: true; fullName: true } } };
}>;

const ORDER_COLUMNS: CsvColumn<ExportOrderRow>[] = [
  { header: "Mã đơn", value: (o) => o.id },
  { header: "Ngày đặt", value: (o) => formatShopDateTime(o.createdAt) },
  {
    header: "Ngày hoàn thành",
    value: (o) => (o.completedAt ? formatShopDateTime(o.completedAt) : null),
  },
  { header: "Khách hàng", value: (o) => o.user.fullName ?? o.user.username },
  { header: "Email", value: (o) => o.user.username },
  { header: "Người nhận", value: (o) => o.receiverName },
  { header: "SĐT", value: (o) => o.receiverPhone },
  { header: "Địa chỉ", value: (o) => o.receiverAddress },
  { header: "Tạm tính", value: (o) => o.subtotalPrice },
  { header: "Giảm giá sản phẩm", value: (o) => o.productDiscountAmount },
  { header: "Giảm giá coupon", value: (o) => o.couponDiscountAmount },
  { header: "Tổng tiền", value: (o) => o.totalPrice },
  { header: "Trạng thái", value: (o) => o.status },
  { header: "Thanh toán", value: (o) => o.paymentStatus },
];

export const exportOrders = async (q: AdminExportOrdersQuery) => {
  const where = adminOrderWhere(q);
  assertExportSize(await prisma.order.count({ where }));
  const rows = await prisma.order.findMany({
    where,
    include: { user: { select: { username: true, fullName: true } } },
    orderBy: { id: "desc" },
  });
  return toCsv(ORDER_COLUMNS, rows);
};
