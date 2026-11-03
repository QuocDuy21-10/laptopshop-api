import type { BaseProduct, DemoDataset } from "scripts/demo-seed/types";
import { buildOrders } from "scripts/demo-seed/orders";
import { createRng } from "scripts/demo-seed/random";
import { buildCatalog } from "scripts/demo-seed/catalog";
import { buildReviews } from "scripts/demo-seed/reviews";
import { buildCustomers } from "scripts/demo-seed/customers";
import { buildPromotions } from "scripts/demo-seed/promotions";
import { buildAfterSales } from "scripts/demo-seed/after-sales";
import { createStockLedger } from "scripts/demo-seed/stock-ledger";

export type BuildDemoInput = {
  seed: number;
  now: Date;
  baseProducts: BaseProduct[];
  adminId: number;
  userRoleId: number;
  firstUserId: number;
  passwordHash: string;
};

export const buildDemoDataset = (input: BuildDemoInput): DemoDataset => {
  const { now, adminId } = input;
  const rng = createRng(input.seed);
  const catalog = buildCatalog(rng, now, input.baseProducts, adminId);
  const customers = buildCustomers(rng, now, {
    firstUserId: input.firstUserId,
    userRoleId: input.userRoleId,
    passwordHash: input.passwordHash,
    products: catalog.products,
  });
  const promotions = buildPromotions(rng, now, catalog.products, adminId);
  const ledger = createStockLedger(
    catalog.products.map((p) => ({
      productId: p.id,
      quantity: p.openingQuantity,
      at: catalog.openingAt,
    })),
  );
  const orders = buildOrders(rng, {
    now,
    products: catalog.products,
    users: customers.users,
    adminId,
    promotions,
    receipts: catalog.receipts,
    ledger,
  });
  const reviews = buildReviews(rng, {
    now,
    placed: orders.placed,
    users: customers.users,
    adminId,
  });
  const afterSales = buildAfterSales(rng, {
    now,
    placed: orders.placed,
    productNames: new Map(catalog.products.map((p) => [p.id, p.name])),
    adminId,
  });
  const finalStock = (id: number) => ({ quantity: ledger.balance(id), sold: ledger.sold(id) });

  return {
    products: catalog.productRows.map((row) => ({ ...row, ...finalStock(row.id) })),
    productUpdates: input.baseProducts.map((p) => ({ id: p.id, ...finalStock(p.id) })),
    stockReceipts: catalog.stockReceipts,
    stockReceiptItems: catalog.stockReceiptItems,
    homeBanners: catalog.homeBanners,
    bannerImages: catalog.bannerImages,
    users: customers.userRows,
    carts: customers.carts,
    cartDetails: customers.cartDetails,
    wishlistItems: customers.wishlistItems,
    newsletterSubscribers: customers.newsletterSubscribers,
    promotions: promotions.promotions,
    couponPolicies: promotions.couponPolicies.map((policy) => ({
      ...policy,
      usedCount: orders.couponUsedCount.get(policy.promotionId) ?? 0,
    })),
    automaticPromotionPolicies: promotions.automaticPromotionPolicies,
    flashSalePolicies: promotions.flashSalePolicies,
    promotionProducts: promotions.promotionProducts,
    flashSaleProductQuotas: promotions.flashSaleProductQuotas.map((quota) => ({
      ...quota,
      claimedUnits: orders.flashClaimedUnits.get(`${quota.promotionId}:${quota.productId}`) ?? 0,
    })),
    orders: orders.orders,
    orderDetails: orders.orderDetails,
    orderStatusHistory: orders.orderStatusHistory,
    payments: orders.payments,
    promotionRedemptions: orders.promotionRedemptions,
    promotionUserUsages: orders.promotionUserUsages,
    flashSaleAllocations: orders.flashSaleAllocations,
    flashSaleUserUsages: orders.flashSaleUserUsages,
    stockMovements: ledger.movements,
    reviews: reviews.reviews,
    reviewReplies: reviews.reviewReplies,
    reviewHelpful: reviews.reviewHelpful,
    ...afterSales,
  };
};
