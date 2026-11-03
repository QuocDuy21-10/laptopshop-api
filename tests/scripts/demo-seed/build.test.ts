import { buildDemoDataset } from "scripts/demo-seed/build";
import { ADMIN_ID, BASE_PRODUCTS, NOW } from "./fixtures";

const input = {
  seed: 20261102,
  now: NOW,
  baseProducts: BASE_PRODUCTS,
  adminId: ADMIN_ID,
  userRoleId: 2,
  firstUserId: 3,
  passwordHash: "hash",
};
const dataset = buildDemoDataset(input);

const unique = (values: unknown[]) =>
  new Set(values.map((v) => JSON.stringify(v))).size === values.length;

describe("buildDemoDataset", () => {
  it("is deterministic for the same seed and now", () => {
    expect(JSON.stringify(buildDemoDataset(input))).toBe(JSON.stringify(dataset));
    expect(JSON.stringify(buildDemoDataset({ ...input, seed: 1 }))).not.toBe(
      JSON.stringify(dataset),
    );
  });

  it("writes final stock and counters from the simulation", () => {
    expect(dataset.products).toHaveLength(40);
    expect(dataset.productUpdates.map((u) => u.id)).toEqual(BASE_PRODUCTS.map((p) => p.id));
    const ledgerTotal = (id: number) =>
      dataset.stockMovements.filter((m) => m.productId === id).reduce((s, m) => s + m.delta, 0);
    [...dataset.products, ...dataset.productUpdates].forEach((p) =>
      expect(p.quantity).toBe(ledgerTotal(p.id)),
    );
    dataset.couponPolicies.forEach((policy) =>
      expect(policy.usedCount).toBe(
        dataset.promotionRedemptions.filter(
          (r) => r.promotionId === policy.promotionId && r.status === "APPLIED",
        ).length,
      ),
    );
    dataset.flashSaleProductQuotas.forEach((quota) =>
      expect(quota.claimedUnits).toBe(
        dataset.flashSaleAllocations
          .filter(
            (a) =>
              a.promotionId === quota.promotionId &&
              a.productId === quota.productId &&
              a.status === "CLAIMED",
          )
          .reduce((s, a) => s + a.quantity, 0),
      ),
    );
  });

  it("respects the unique keys of the schema", () => {
    expect(unique(dataset.users.map((u) => u.username))).toBe(true);
    expect(unique(dataset.cartDetails.map((d) => [d.cartId, d.productId]))).toBe(true);
    expect(unique(dataset.wishlistItems.map((w) => [w.userId, w.productId]))).toBe(true);
    expect(unique(dataset.newsletterSubscribers.map((s) => s.email))).toBe(true);
    expect(unique(dataset.orders.map((o) => [o.userId, o.idempotencyKey]))).toBe(true);
    expect(unique(dataset.payments.map((p) => p.transferCode))).toBe(true);
    expect(unique(dataset.reviews.map((r) => r.orderDetailId))).toBe(true);
    expect(unique(dataset.reviews.map((r) => [r.userId, r.productId]))).toBe(true);
    expect(unique(dataset.reviewHelpful.map((h) => [h.reviewId, h.userId]))).toBe(true);
    expect(unique(dataset.promotionProducts.map((p) => [p.promotionId, p.productId]))).toBe(true);
    expect(unique(dataset.flashSaleAllocations.map((a) => a.orderDetailId))).toBe(true);
    expect(unique(dataset.serviceRequests.map((r) => r.code))).toBe(true);
    expect(unique(dataset.stockReceiptItems.map((i) => [i.receiptId, i.productId]))).toBe(true);
  });
});
