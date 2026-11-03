import { NOW, buildOrderFixture, time } from "./fixtures";
import { ORDER_STATUSES, canTransition } from "modules/orders/order-status";

const { catalog, promotions, ledger, orders } = buildOrderFixture();
const orderById = new Map(orders.orders.map((o) => [o.id, o]));
const statusOf = (value: string) => {
  const status = ORDER_STATUSES.find((s) => s === value);
  if (!status) throw new Error(`unknown status ${value}`);
  return status;
};

describe("buildOrders", () => {
  it("creates about 260 orders with every status, ids in placement order", () => {
    expect(orders.orders.length).toBeGreaterThanOrEqual(230);
    expect(orders.orders.length).toBeLessThanOrEqual(260);
    const statuses = new Set(orders.orders.map((o) => o.status));
    expect(statuses).toEqual(new Set(["PENDING", "SHIPPING", "COMPLETED", "CANCELLED"]));
    const completed = orders.orders.filter((o) => o.status === "COMPLETED").length;
    expect(completed / orders.orders.length).toBeGreaterThan(0.5);
    const times = orders.orders.map((o) => time(o.createdAt));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(Math.max(...times)).toBeLessThan(NOW.getTime());
  });

  it("keeps order totals equal to their lines", () => {
    for (const order of orders.orders) {
      const lines = orders.orderDetails.filter((d) => d.orderId === order.id);
      const subtotal = lines.reduce((s, d) => s + d.price * d.quantity, 0);
      const product = lines.reduce((s, d) => s + (d.productDiscountAmount ?? 0), 0);
      const coupon = lines.reduce((s, d) => s + (d.couponDiscountAmount ?? 0), 0);
      expect(order.subtotalPrice).toBe(subtotal);
      expect(order.productDiscountAmount).toBe(product);
      expect(order.couponDiscountAmount).toBe(coupon);
      expect(order.totalPrice).toBe(subtotal - product - coupon);
      expect(order.totalPrice).toBeGreaterThan(0);
    }
  });

  it("writes a valid, chronological status history", () => {
    for (const order of orders.orders) {
      const history = orders.orderStatusHistory.filter((h) => h.orderId === order.id);
      expect(history[0]).toMatchObject({ fromStatus: null, toStatus: "PENDING" });
      history.slice(1).forEach((h, i) => {
        expect(canTransition(String(h.fromStatus), statusOf(h.toStatus))).toBe(true);
        expect(time(h.createdAt)).toBeGreaterThanOrEqual(time(history[i].createdAt));
      });
      expect(history[history.length - 1].toStatus).toBe(order.status);
      if (order.status === "COMPLETED")
        expect(time(order.completedAt)).toBe(time(history[history.length - 1].createdAt));
    }
  });

  it("matches payments to the payment method and status", () => {
    for (const order of orders.orders) {
      const payment = orders.payments.find((p) => p.orderId === order.id);
      if (order.paymentMethod === "COD") {
        expect(payment).toBeUndefined();
        expect(order.paymentStatus).toBe(
          order.status === "COMPLETED" ? "PAYMENT_SUCCESS" : "PAYMENT_UNPAID",
        );
        continue;
      }
      expect(payment?.amount).toBe(order.totalPrice);
      if (order.status === "SHIPPING" || order.status === "COMPLETED") {
        expect(order.paymentStatus).toBe("PAYMENT_SUCCESS");
        expect(payment?.status).toBe("SUCCEEDED");
      }
      if (order.status === "CANCELLED") {
        expect(order.paymentStatus).toBe("PAYMENT_FAILED");
        expect(["CANCELLED", "EXPIRED"]).toContain(payment?.status);
      }
    }
    const qr = orders.payments.filter((p) => p.status === "PENDING");
    expect(qr.length).toBeGreaterThanOrEqual(2);
    qr.forEach((p) => expect(time(p.expiresAt)).toBeGreaterThan(NOW.getTime()));
    const codes = orders.payments.map((p) => p.transferCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("snapshots warranty only for completed orders", () => {
    for (const detail of orders.orderDetails) {
      const order = orderById.get(detail.orderId);
      expect(detail.warrantyPolicySource).toBe("CHECKOUT_SNAPSHOT");
      if (order?.status === "COMPLETED" && (detail.warrantyMonthsSnapshot ?? 0) > 0)
        expect(time(detail.warrantyStartAt)).toBe(time(order.completedAt));
      else expect(detail.warrantyStartAt ?? null).toBeNull();
    }
  });

  it("keeps coupon and flash sale counters consistent", () => {
    const applied = orders.promotionRedemptions.filter((r) => r.status === "APPLIED");
    expect(applied.length).toBeGreaterThan(0);
    for (const coupon of promotions.coupons) {
      const used = applied.filter((r) => r.promotionId === coupon.id).length;
      expect(orders.couponUsedCount.get(coupon.id) ?? 0).toBe(used);
      if (coupon.maxUses !== null) expect(used).toBeLessThanOrEqual(coupon.maxUses);
    }
    orders.promotionUserUsages.forEach((u) => {
      const coupon = promotions.coupons.find((c) => c.id === u.promotionId);
      expect(u.usedCount).toBeLessThanOrEqual(coupon?.maxUsesPerUser ?? 0);
    });
    const live = promotions.flashSales[0];
    const claimed = orders.flashSaleAllocations.filter((a) => a.status === "CLAIMED");
    expect(claimed.length).toBeGreaterThan(0);
    for (const [productId, quota] of live.quotas) {
      const units = claimed
        .filter((a) => a.promotionId === live.id && a.productId === productId)
        .reduce((s, a) => s + a.quantity, 0);
      expect(orders.flashClaimedUnits.get(`${live.id}:${productId}`) ?? 0).toBe(units);
      expect(units).toBeLessThanOrEqual(quota.totalQuota);
    }
    orders.flashSaleUserUsages.forEach((u) => expect(u.claimedUnits).toBeLessThanOrEqual(2));
  });

  it("keeps the ledger chained, sold equal to live orders, and end states reached", () => {
    const byProduct = new Map<number, number[]>();
    ledger.movements.forEach((m) => {
      const chain = byProduct.get(m.productId) ?? [];
      if (chain.length) expect(m.balanceBefore).toBe(chain[chain.length - 1]);
      chain.push(m.balanceAfter);
      byProduct.set(m.productId, chain);
      expect(m.balanceAfter).toBeGreaterThanOrEqual(0);
    });
    for (const product of catalog.products) {
      const live = orders.orderDetails
        .filter(
          (d) => d.productId === product.id && orderById.get(d.orderId)?.status !== "CANCELLED",
        )
        .reduce((s, d) => s + d.quantity, 0);
      expect(ledger.sold(product.id)).toBe(live);
      if (product.endState === "OUT_OF_STOCK") expect(ledger.balance(product.id)).toBe(0);
      if (product.endState === "LOW_STOCK")
        expect(ledger.balance(product.id)).toBeLessThanOrEqual(5);
    }
    const times = ledger.movements.map((m) => time(m.createdAt));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});
