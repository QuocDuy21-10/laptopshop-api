import { existsSync } from "fs";
import path from "path";

import { factoryOptions, targetOptions } from "config/constant";
import { createRng } from "scripts/demo-seed/random";
import { buildCatalog } from "scripts/demo-seed/catalog";
import { ADMIN_ID, BASE_PRODUCTS, NOW } from "./fixtures";

const catalog = buildCatalog(createRng(1), NOW, BASE_PRODUCTS, ADMIN_ID);

describe("buildCatalog", () => {
  it("adds 40 products after the base ids, covering every factory and target", () => {
    expect(catalog.productRows).toHaveLength(40);
    expect(catalog.productRows[0].id).toBe(11);
    expect(catalog.products).toHaveLength(50);
    const factories = new Set(catalog.products.map((p) => p.factory));
    const targets = new Set(catalog.products.map((p) => p.target));
    factoryOptions.forEach(({ value }) => expect(factories.has(value)).toBe(true));
    targetOptions.forEach(({ value }) => expect(targets.has(value)).toBe(true));
  });

  it("only uses tracked images that exist", () => {
    for (const row of catalog.productRows)
      expect(existsSync(path.join("public/images/product", String(row.image)))).toBe(true);
    for (const image of catalog.bannerImages)
      expect(existsSync(path.join("public/images/product", image.from))).toBe(true);
  });

  it("marks the stock end states and inactive products", () => {
    const count = (state: string) => catalog.products.filter((p) => p.endState === state).length;
    expect(count("OUT_OF_STOCK")).toBe(3);
    expect(count("LOW_STOCK")).toBe(4);
    expect(catalog.products.filter((p) => !p.isActive)).toHaveLength(2);
    expect(catalog.productRows.filter((row) => row.isActive === false)).toHaveLength(2);
  });

  it("posts six receipts for active products and keeps two drafts", () => {
    expect(catalog.receipts).toHaveLength(6);
    expect(catalog.stockReceipts.filter((r) => r.status === "DRAFT")).toHaveLength(2);
    const active = new Set(catalog.products.filter((p) => p.isActive).map((p) => p.id));
    catalog.receipts.forEach((receipt) => {
      expect(receipt.postedAt < NOW).toBe(true);
      receipt.items.forEach((item) => expect(active.has(item.productId)).toBe(true));
    });
    expect(catalog.openingAt < catalog.receipts[0].postedAt).toBe(true);
  });

  it("builds banners within the admin validation limits", () => {
    expect(catalog.homeBanners).toHaveLength(6);
    catalog.homeBanners.forEach((banner) => {
      expect(banner.title.length).toBeLessThanOrEqual(80);
      expect((banner.description ?? "").length).toBeLessThanOrEqual(200);
      if (banner.placement === "SIDE") expect(banner.badges).toEqual([]);
    });
  });
});
