import { createRng } from "scripts/demo-seed/random";
import { buildCatalog } from "scripts/demo-seed/catalog";
import { buildCustomers } from "scripts/demo-seed/customers";
import { ADMIN_ID, BASE_PRODUCTS, NOW } from "./fixtures";

const rng = createRng(2);
const catalog = buildCatalog(rng, NOW, BASE_PRODUCTS, ADMIN_ID);
const customers = buildCustomers(rng, NOW, {
  firstUserId: 3,
  userRoleId: 2,
  passwordHash: "hash",
  products: catalog.products,
});

describe("buildCustomers", () => {
  it("creates 30 demo users with unique usernames", () => {
    expect(customers.userRows).toHaveLength(30);
    expect(customers.userRows[0]).toMatchObject({
      id: 3,
      username: "user01@demo.local",
      roleId: 2,
      password: "hash",
    });
    expect(new Set(customers.userRows.map((u) => u.username)).size).toBe(30);
  });

  it("fills ten carts with in-stock active products only", () => {
    const shoppable = new Set(
      catalog.products.filter((p) => p.isActive && p.endState === "NORMAL").map((p) => p.id),
    );
    expect(customers.carts).toHaveLength(10);
    customers.cartDetails.forEach((d) => expect(shoppable.has(d.productId)).toBe(true));
    const keys = customers.cartDetails.map((d) => `${d.cartId}:${d.productId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("creates 60 unique wishlist items with valid price alerts", () => {
    expect(customers.wishlistItems).toHaveLength(60);
    const keys = customers.wishlistItems.map((w) => `${w.userId}:${w.productId}`);
    expect(new Set(keys).size).toBe(60);
    customers.wishlistItems.forEach((w) => {
      if (w.alertMode === "TARGET_PRICE") expect(w.targetPrice).toBeLessThan(w.referencePrice ?? 0);
      if (w.alertMode === "PERCENT_DROP") expect(w.targetPrice).toBeNull();
    });
    expect(customers.wishlistItems.some((w) => w.alertMode)).toBe(true);
  });

  it("covers every newsletter status", () => {
    expect(customers.newsletterSubscribers).toHaveLength(40);
    const statuses = new Set(customers.newsletterSubscribers.map((s) => s.status));
    expect(statuses).toEqual(new Set(["CONFIRMED", "PENDING", "UNSUBSCRIBED"]));
  });
});
