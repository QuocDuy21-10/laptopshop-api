import { DAY, HOUR, createRng, shift } from "scripts/demo-seed/random";
import { buildCatalog } from "scripts/demo-seed/catalog";
import {
  automaticAt,
  buildPromotions,
  couponsAt,
  flashSaleAt,
  resolveFlashSale,
} from "scripts/demo-seed/promotions";
import { ADMIN_ID, BASE_PRODUCTS, NOW } from "./fixtures";

const rng = createRng(3);
const catalog = buildCatalog(rng, NOW, BASE_PRODUCTS, ADMIN_ID);
const promos = buildPromotions(rng, NOW, catalog.products, ADMIN_ID);

describe("buildPromotions", () => {
  it("creates 4 coupons, 3 automatics and 2 flash sales", () => {
    expect(promos.promotions).toHaveLength(9);
    expect(promos.couponPolicies.map((p) => p.code)).toEqual([
      "DEMO10",
      "GAMING500K",
      "SUMMER15",
      "TET2027",
    ]);
    expect(promos.automaticPromotionPolicies).toHaveLength(3);
    expect(promos.flashSalePolicies).toHaveLength(2);
    expect(promos.promotions.map((p) => p.state)).toEqual(
      expect.arrayContaining(["ACTIVE", "ENDED", "DRAFT"]),
    );
  });

  it("runs one flash sale now with five in-stock products and none overlapping live automatics", () => {
    const live = promos.flashSales.filter((sale) => sale.startsAt <= NOW && NOW < sale.endsAt);
    expect(live).toHaveLength(1);
    expect(live[0].quotas.size).toBe(5);
    for (const productId of live[0].quotas.keys()) {
      expect(automaticAt(promos.automatics, productId, NOW)).toBeNull();
      expect(flashSaleAt(promos.flashSales, productId, NOW)).toBe(live[0]);
    }
  });

  it("never applies a draft coupon and keeps ended ones inside their window", () => {
    expect(couponsAt(promos.coupons, NOW).map((c) => c.code)).toEqual(["DEMO10", "GAMING500K"]);
    expect(couponsAt(promos.coupons, shift(NOW, -150 * DAY)).map((c) => c.code)).toContain(
      "SUMMER15",
    );
    expect(couponsAt(promos.coupons, shift(NOW, 70 * DAY)).map((c) => c.code)).not.toContain(
      "TET2027",
    );
  });

  it("resolves a flash sale with remaining quota for the user", () => {
    const sale = promos.flashSales[0];
    const [productId, quota] = [...sale.quotas.entries()][0];
    const resolved = resolveFlashSale(sale, productId, 20_000_000, 3, 1);
    expect(resolved).toMatchObject({
      kind: "FLASH_SALE",
      unitDiscount: 3_000_000,
      remainingQuota: quota.totalQuota - 3,
      userRemainingQuota: quota.maxUnitsPerUser - 1,
    });
    expect(sale.startsAt).toEqual(shift(NOW, -20 * HOUR));
  });
});
