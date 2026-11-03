import type { Prisma } from "@prisma/client";

import type { DemoProduct, DemoUser, WithId } from "scripts/demo-seed/types";
import { DAY, HOUR, MINUTE, shift, type Rng } from "scripts/demo-seed/random";
import type { PostedReceipt } from "scripts/demo-seed/catalog";
import { ORDER_STATUS, PAYMENT_STATUS, type OrderStatus } from "modules/orders/order-status";
import { randomFullName, randomPhone } from "scripts/demo-seed/customers";
import {
  automaticAt,
  couponsAt,
  flashSaleAt,
  resolveAutomatic,
  resolveFlashSale,
  type DemoCoupon,
  type PromotionsResult,
} from "scripts/demo-seed/promotions";
import { warrantySnapshotForCompletion } from "modules/orders/order-warranty";
import type { StockLedger } from "scripts/demo-seed/stock-ledger";
import { createTransferCode } from "modules/payments/payment-reference";
import type { PricingLineInput, ResolvedPromotion } from "modules/promotions/promotions.types";
import { calculatePromotionPricing } from "modules/promotions/promotion-pricing";

export const RECENT_ORDER_COUNT = 232;
export const FLASH_ORDER_COUNT = 8;
export const OLD_ORDER_COUNT = 20;
const PAYMENT_TTL = 15 * MINUTE;
// nothing is scheduled closer to `now` than this, so every timestamp is in the past
const SETTLE_GAP = 5 * MINUTE;

type Method = "COD" | "BANK_TRANSFER";

type Plan = {
  at: Date;
  user: DemoUser;
  method: Method;
  status: OrderStatus;
  lines: { productId: number; quantity: number }[];
  couponId: number | null;
  paidAt: Date | null;
  shippedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelledFrom: "PENDING" | "SHIPPING" | null;
  expired: boolean;
  receiver: { name: string; phone: string; address: string };
};

export type PlacedLine = {
  detailId: number;
  productId: number;
  warrantyMonths: number;
  warrantyStartAt: Date | null;
  warrantyEndAt: Date | null;
};

export type PlacedOrder = {
  id: number;
  userId: number;
  status: OrderStatus;
  completedAt: Date | null;
  lines: PlacedLine[];
};

export type OrdersInput = {
  now: Date;
  products: DemoProduct[];
  users: DemoUser[];
  adminId: number;
  promotions: PromotionsResult;
  receipts: PostedReceipt[];
  ledger: StockLedger;
};

export type OrdersResult = {
  placed: PlacedOrder[];
  orders: WithId<Prisma.OrderCreateManyInput>[];
  orderDetails: WithId<Prisma.OrderDetailCreateManyInput>[];
  orderStatusHistory: Prisma.OrderStatusHistoryCreateManyInput[];
  payments: Prisma.PaymentCreateManyInput[];
  promotionRedemptions: (Prisma.PromotionRedemptionCreateManyInput & { orderId: number })[];
  promotionUserUsages: Prisma.PromotionUserUsageCreateManyInput[];
  flashSaleAllocations: Prisma.FlashSaleAllocationCreateManyInput[];
  flashSaleUserUsages: Prisma.FlashSaleUserUsageCreateManyInput[];
  couponUsedCount: Map<number, number>;
  flashClaimedUnits: Map<string, number>;
};

const must = <K, V>(map: Map<K, V>, key: K): V => {
  const value = map.get(key);
  if (value === undefined) throw new Error(`demo seed: missing ${String(key)}`);
  return value;
};
const bump = <K>(map: Map<K, number>, key: K, by: number) => map.set(key, (map.get(key) ?? 0) + by);

const planTimeline = (rng: Rng, now: Date, plan: Plan) => {
  const latest = shift(now, -SETTLE_GAP);
  const at = plan.at;
  if (plan.status === "SHIPPING" || plan.status === "COMPLETED")
    plan.shippedAt = shift(at, rng.int(2, 24) * HOUR);
  if (plan.status === "COMPLETED" && plan.shippedAt)
    plan.completedAt = shift(plan.shippedAt, rng.int(1, 4) * DAY);
  if (plan.completedAt && plan.completedAt > latest) {
    plan.status = "SHIPPING";
    plan.completedAt = null;
  }
  if (plan.shippedAt && plan.shippedAt > latest) {
    plan.status = "PENDING";
    plan.shippedAt = null;
  }
  if (plan.status === "CANCELLED") {
    if (plan.method === "BANK_TRANSFER") {
      plan.expired = rng.chance(0.5);
      plan.cancelledFrom = "PENDING";
      plan.cancelledAt = shift(
        at,
        plan.expired ? PAYMENT_TTL + 2 * MINUTE : rng.int(1, 10) * MINUTE,
      );
    } else if (rng.chance(0.7)) {
      plan.cancelledFrom = "PENDING";
      plan.cancelledAt = shift(at, rng.int(1, 30) * HOUR);
    } else {
      plan.cancelledFrom = "SHIPPING";
      plan.shippedAt = shift(at, rng.int(2, 24) * HOUR);
      plan.cancelledAt = shift(plan.shippedAt, rng.int(1, 24) * HOUR);
    }
    if (plan.cancelledAt > latest) {
      plan.status = "PENDING";
      plan.cancelledAt = null;
      plan.cancelledFrom = null;
      plan.shippedAt = null;
      plan.expired = false;
    }
  }
  // a fresh pending bank transfer still waits on its QR; every other non-cancelled one is paid
  const freshQr = plan.status === "PENDING" && now.getTime() - at.getTime() <= DAY;
  if (plan.method === "BANK_TRANSFER" && plan.status !== "CANCELLED" && !freshQr)
    plan.paidAt = shift(at, rng.int(2, 20) * MINUTE);
};

export const buildOrders = (rng: Rng, input: OrdersInput): OrdersResult => {
  const { now, adminId, promotions, ledger } = input;
  const productById = new Map(input.products.map((p) => [p.id, p]));
  const couponById = new Map(promotions.coupons.map((c) => [c.id, c]));
  const shoppable = input.products.filter((p) => p.isActive);
  const liveFlash = promotions.flashSales.find((s) => s.startsAt <= now && now < s.endsAt);

  const newPlan = (at: Date, options: { old: boolean; flashIndex?: number }): Plan => {
    const user = rng.pick(input.users);
    const forcedQr = options.flashIndex !== undefined && options.flashIndex < 3;
    const method: Method = options.old
      ? "COD"
      : forcedQr
        ? "BANK_TRANSFER"
        : rng.weighted([
            ["COD", 70],
            ["BANK_TRANSFER", 30],
          ] as const);
    const ageDays = (now.getTime() - at.getTime()) / DAY;
    const status: OrderStatus = options.old
      ? "COMPLETED"
      : forcedQr
        ? "PENDING"
        : ageDays <= 14
          ? rng.weighted([
              ["PENDING", 35],
              ["SHIPPING", 30],
              ["COMPLETED", 20],
              ["CANCELLED", 15],
            ] as const)
          : rng.weighted([
              ["COMPLETED", 83],
              ["CANCELLED", 17],
            ] as const);
    const count = rng.weighted([
      [1, 60],
      [2, 30],
      [3, 10],
    ] as const);
    const ids = new Set<number>();
    if (options.flashIndex !== undefined && liveFlash) ids.add(rng.pick(liveFlash.productIds));
    while (ids.size < count) ids.add(rng.pick(shoppable).id);
    const coupon = !options.old && rng.chance(0.15) ? couponsAt(promotions.coupons, at) : [];
    const ownReceiver = rng.chance(0.85);
    const plan: Plan = {
      at,
      user,
      method,
      status,
      lines: [...ids].map((productId) => ({
        productId,
        quantity: rng.weighted([
          [1, 80],
          [2, 20],
        ] as const),
      })),
      couponId: coupon.length ? rng.pick(coupon).id : null,
      paidAt: null,
      shippedAt: null,
      completedAt: null,
      cancelledAt: null,
      cancelledFrom: null,
      expired: false,
      receiver: {
        name: ownReceiver ? user.fullName : randomFullName(rng),
        phone: ownReceiver ? user.phone : randomPhone(rng),
        address: user.address,
      },
    };
    planTimeline(rng, now, plan);
    return plan;
  };

  const plans: Plan[] = [
    ...Array.from({ length: OLD_ORDER_COUNT }, () =>
      newPlan(rng.dateBetween(shift(now, -18 * 30 * DAY), shift(now, -13 * 30 * DAY)), {
        old: true,
      }),
    ),
    // sqrt skews the days toward now, so monthly revenue grows over the six months
    ...Array.from({ length: RECENT_ORDER_COUNT }, () =>
      newPlan(shift(now, -(180 * (1 - Math.sqrt(rng.next()))) * DAY - 10 * MINUTE), { old: false }),
    ),
    ...(liveFlash
      ? Array.from({ length: FLASH_ORDER_COUNT }, (_, flashIndex) =>
          newPlan(rng.dateBetween(liveFlash.startsAt, shift(now, -30 * MINUTE)), {
            old: false,
            flashIndex,
          }),
        )
      : []),
  ];

  const orders: OrdersResult["orders"] = [];
  const orderDetails: OrdersResult["orderDetails"] = [];
  const orderStatusHistory: OrdersResult["orderStatusHistory"] = [];
  const payments: OrdersResult["payments"] = [];
  const promotionRedemptions: OrdersResult["promotionRedemptions"] = [];
  const flashSaleAllocations: OrdersResult["flashSaleAllocations"] = [];
  const placed: PlacedOrder[] = [];
  const placedByPlan = new Map<Plan, PlacedOrder>();
  const couponUsed = new Map<number, number>();
  const couponUserUsed = new Map<string, number>();
  const flashClaimed = new Map<string, number>();
  const flashUserClaimed = new Map<string, number>();
  let nextOrderId = 1;
  let nextDetailId = 1;
  let nextRedemptionId = 1;
  let nextAllocationId = 1;

  const promotionFor = (
    plan: Plan,
    productId: number,
    quantity: number,
    listPrice: number,
  ): ResolvedPromotion | null => {
    const sale = flashSaleAt(promotions.flashSales, productId, plan.at);
    if (sale) {
      const quota = must(sale.quotas, productId);
      const claimed = flashClaimed.get(`${sale.id}:${productId}`) ?? 0;
      const userClaimed = flashUserClaimed.get(`${sale.id}:${productId}:${plan.user.id}`) ?? 0;
      if (quantity <= quota.totalQuota - claimed && quantity <= quota.maxUnitsPerUser - userClaimed)
        return resolveFlashSale(sale, productId, listPrice, claimed, userClaimed);
    }
    const automatic = automaticAt(promotions.automatics, productId, plan.at);
    return automatic ? resolveAutomatic(automatic, listPrice) : null;
  };

  const couponAllowed = (coupon: DemoCoupon, userId: number) =>
    (coupon.maxUses === null || (couponUsed.get(coupon.id) ?? 0) < coupon.maxUses) &&
    (couponUserUsed.get(`${coupon.id}:${userId}`) ?? 0) < coupon.maxUsesPerUser;

  const place = (plan: Plan) => {
    const lines = plan.lines.filter((line) => ledger.balance(line.productId) >= line.quantity);
    if (lines.length === 0) return;
    const orderId = nextOrderId++;
    const userId = plan.user.id;
    const pricingLines: PricingLineInput[] = lines.map((line) => {
      const listPrice = must(productById, line.productId).price;
      return {
        productId: line.productId,
        quantity: line.quantity,
        listPrice,
        promotion: promotionFor(plan, line.productId, line.quantity, listPrice),
        promotionFallback: null,
      };
    });
    const coupon = plan.couponId ? couponById.get(plan.couponId) : undefined;
    let pricing = calculatePromotionPricing({
      lines: pricingLines,
      coupon: coupon && couponAllowed(coupon, userId) ? coupon : null,
    });
    if (pricing.coupon && pricing.couponDiscountAmount === 0)
      pricing = calculatePromotionPricing({ lines: pricingLines, coupon: null });

    const fresh = plan.status === "PENDING" && !plan.paidAt;
    orders.push({
      id: orderId,
      userId,
      totalPrice: pricing.totalPrice,
      subtotalPrice: pricing.subtotalPrice,
      productDiscountAmount: pricing.productDiscountAmount,
      couponEligibleSubtotal: pricing.couponEligibleSubtotal,
      couponDiscountAmount: pricing.couponDiscountAmount,
      couponPromotionId: pricing.coupon?.id ?? null,
      couponCode: pricing.coupon?.code ?? null,
      couponName: pricing.coupon?.name ?? null,
      requestHash: rng.hex(64),
      receiverAddress: plan.receiver.address,
      receiverName: plan.receiver.name,
      receiverPhone: plan.receiver.phone,
      status: plan.status,
      paymentMethod: plan.method,
      paymentStatus:
        plan.method === "COD"
          ? plan.status === ORDER_STATUS.COMPLETED
            ? PAYMENT_STATUS.SUCCESS
            : PAYMENT_STATUS.UNPAID
          : plan.paidAt
            ? PAYMENT_STATUS.SUCCESS
            : plan.status === ORDER_STATUS.CANCELLED
              ? PAYMENT_STATUS.FAILED
              : PAYMENT_STATUS.UNPAID,
      paymentRef: null,
      idempotencyKey: rng.uuid(),
      createdAt: plan.at,
      completedAt: plan.completedAt,
    });

    if (pricing.coupon) {
      bump(couponUsed, pricing.coupon.id, 1);
      bump(couponUserUsed, `${pricing.coupon.id}:${userId}`, 1);
      promotionRedemptions.push({
        id: nextRedemptionId++,
        promotionId: pricing.coupon.id,
        userId,
        orderId,
        discountAmount: pricing.couponDiscountAmount,
        status: "APPLIED",
        createdAt: plan.at,
      });
    }

    const placedLines: PlacedLine[] = [];
    for (const line of pricing.lines) {
      const product = must(productById, line.productId);
      const warranty = plan.completedAt
        ? warrantySnapshotForCompletion({
            months: product.warrantyMonths,
            completedAt: plan.completedAt,
          })
        : { startAt: null, endAt: null };
      const detailId = nextDetailId++;
      orderDetails.push({
        id: detailId,
        orderId,
        productId: line.productId,
        price: line.listPrice,
        quantity: line.quantity,
        productDiscountAmount: line.productDiscountAmount,
        couponDiscountAmount: line.couponDiscountAmount,
        automaticPromotionId: line.automaticPromotion?.id ?? null,
        automaticPromotionName: line.automaticPromotion?.name ?? null,
        warrantyMonthsSnapshot: product.warrantyMonths,
        warrantyStartAt: warranty.startAt,
        warrantyEndAt: warranty.endAt,
        warrantyPolicySource: "CHECKOUT_SNAPSHOT",
      });
      placedLines.push({
        detailId,
        productId: line.productId,
        warrantyMonths: product.warrantyMonths,
        warrantyStartAt: warranty.startAt,
        warrantyEndAt: warranty.endAt,
      });
      if (line.promotionKind === "FLASH_SALE" && line.automaticPromotion) {
        const promotionId = line.automaticPromotion.id;
        bump(flashClaimed, `${promotionId}:${line.productId}`, line.quantity);
        bump(flashUserClaimed, `${promotionId}:${line.productId}:${userId}`, line.quantity);
        flashSaleAllocations.push({
          id: nextAllocationId++,
          promotionId,
          productId: line.productId,
          userId,
          orderId,
          orderDetailId: detailId,
          quantity: line.quantity,
          discountAmount: line.productDiscountAmount,
          status: "CLAIMED",
          createdAt: plan.at,
        });
      }
      ledger.move({
        productId: line.productId,
        delta: -line.quantity,
        reason: "ORDER",
        at: plan.at,
        orderId,
        actorId: userId,
      });
    }

    orderStatusHistory.push({
      orderId,
      fromStatus: null,
      toStatus: ORDER_STATUS.PENDING,
      actorId: userId,
      createdAt: plan.at,
    });
    if (plan.shippedAt)
      orderStatusHistory.push({
        orderId,
        fromStatus: ORDER_STATUS.PENDING,
        toStatus: ORDER_STATUS.SHIPPING,
        actorId: adminId,
        createdAt: plan.shippedAt,
      });
    if (plan.completedAt)
      orderStatusHistory.push({
        orderId,
        fromStatus: ORDER_STATUS.SHIPPING,
        toStatus: ORDER_STATUS.COMPLETED,
        actorId: adminId,
        createdAt: plan.completedAt,
      });
    if (plan.cancelledAt)
      orderStatusHistory.push({
        orderId,
        fromStatus: plan.cancelledFrom,
        toStatus: ORDER_STATUS.CANCELLED,
        actorId: plan.expired ? null : plan.cancelledFrom === "PENDING" ? userId : adminId,
        reason: plan.expired ? "PAYMENT_EXPIRED" : null,
        createdAt: plan.cancelledAt,
      });

    if (plan.method === "BANK_TRANSFER") {
      // a fresh QR stays payable for a day so the demo can show it
      const expiresAt = fresh ? shift(now, DAY) : shift(plan.at, PAYMENT_TTL);
      payments.push({
        id: rng.uuid(),
        orderId,
        provider: "fake",
        providerMode: "test",
        method: "BANK_TRANSFER",
        status: plan.paidAt
          ? "SUCCEEDED"
          : plan.cancelledAt
            ? plan.expired
              ? "EXPIRED"
              : "CANCELLED"
            : "PENDING",
        amount: pricing.totalPrice,
        currency: "VND",
        transferCode: createTransferCode(rng.next),
        bankCode: "MB",
        accountNumber: "0000000000",
        accountName: "LAPTOPSHOP DEMO",
        expiresAt,
        cancelAfter: shift(expiresAt, 2 * MINUTE),
        reviewAfter: shift(expiresAt, HOUR),
        paidAt: plan.paidAt,
        cancelledAt: plan.cancelledAt,
        createdAt: plan.at,
        updatedAt: plan.paidAt ?? plan.cancelledAt ?? plan.at,
      });
    }

    const order: PlacedOrder = {
      id: orderId,
      userId,
      status: plan.status,
      completedAt: plan.completedAt,
      lines: placedLines,
    };
    placed.push(order);
    placedByPlan.set(plan, order);
  };

  const cancel = (plan: Plan) => {
    const order = placedByPlan.get(plan);
    if (!order || !plan.cancelledAt) return;
    const at = plan.cancelledAt;
    const actorId = plan.expired ? null : plan.cancelledFrom === "PENDING" ? order.userId : adminId;
    for (const detail of orderDetails.filter((d) => d.orderId === order.id))
      ledger.move({
        productId: detail.productId,
        delta: detail.quantity,
        reason: "ORDER_CANCEL",
        at,
        orderId: order.id,
        actorId,
      });
    const redemption = promotionRedemptions.find((r) => r.orderId === order.id);
    if (redemption) {
      redemption.status = "REVERSED";
      redemption.reversedAt = at;
      redemption.reverseReason = "CANCELLED";
      bump(couponUsed, redemption.promotionId, -1);
      bump(couponUserUsed, `${redemption.promotionId}:${order.userId}`, -1);
    }
    for (const allocation of flashSaleAllocations.filter((a) => a.orderId === order.id)) {
      allocation.status = "RELEASED";
      allocation.releasedAt = at;
      allocation.releaseReason = plan.expired ? "EXPIRE" : "CANCEL";
      bump(flashClaimed, `${allocation.promotionId}:${allocation.productId}`, -allocation.quantity);
      bump(
        flashUserClaimed,
        `${allocation.promotionId}:${allocation.productId}:${order.userId}`,
        -allocation.quantity,
      );
    }
  };

  const events = [
    ...input.receipts.map((receipt) => ({
      at: receipt.postedAt,
      rank: 0,
      run: () =>
        receipt.items.forEach((item) =>
          ledger.move({
            productId: item.productId,
            delta: item.quantity,
            reason: "RESTOCK",
            at: receipt.postedAt,
            receiptId: receipt.id,
            actorId: adminId,
          }),
        ),
    })),
    ...plans.flatMap((plan) => [
      { at: plan.at, rank: 1, run: () => place(plan) },
      ...(plan.cancelledAt ? [{ at: plan.cancelledAt, rank: 2, run: () => cancel(plan) }] : []),
    ]),
  ];
  events.sort((a, b) => a.at.getTime() - b.at.getTime() || a.rank - b.rank);
  events.forEach((event) => event.run());

  // the final stock count brings products to their demo end state
  const countedAt = shift(now, -MINUTE);
  for (const product of input.products) {
    const balance = ledger.balance(product.id);
    const target =
      product.endState === "OUT_OF_STOCK"
        ? 0
        : product.endState === "LOW_STOCK"
          ? rng.int(1, 5)
          : product.isActive && balance < 10
            ? rng.int(10, 25)
            : balance;
    if (target !== balance)
      ledger.move({
        productId: product.id,
        delta: target - balance,
        reason: "CORRECTION",
        at: countedAt,
        actorId: adminId,
        note: "Kiểm kê cuối kỳ (dữ liệu demo)",
      });
  }

  const splitKey = (key: string) => key.split(":").map(Number);
  return {
    placed,
    orders,
    orderDetails,
    orderStatusHistory,
    payments,
    promotionRedemptions,
    promotionUserUsages: [...couponUserUsed].map(([key, usedCount]) => {
      const [promotionId, userId] = splitKey(key);
      return { promotionId, userId, usedCount };
    }),
    flashSaleAllocations,
    flashSaleUserUsages: [...flashUserClaimed].map(([key, claimedUnits]) => {
      const [promotionId, productId, userId] = splitKey(key);
      return { promotionId, productId, userId, claimedUnits };
    }),
    couponUsedCount: couponUsed,
    flashClaimedUnits: flashClaimed,
  };
};
