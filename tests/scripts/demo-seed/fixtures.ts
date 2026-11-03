import type { BaseProduct } from "scripts/demo-seed/types";
import { buildOrders } from "scripts/demo-seed/orders";
import { createRng } from "scripts/demo-seed/random";
import { buildCatalog } from "scripts/demo-seed/catalog";
import { buildCustomers } from "scripts/demo-seed/customers";
import { buildPromotions } from "scripts/demo-seed/promotions";
import { createStockLedger } from "scripts/demo-seed/stock-ledger";

export const NOW = new Date("2026-11-02T03:00:00.000Z");
export const ADMIN_ID = 2;

// mirrors what src/config/seed.ts creates (ids 1-10)
export const BASE_PRODUCTS: BaseProduct[] = [
  {
    id: 1,
    name: "Laptop Asus TUF Gaming",
    price: 17_490_000,
    quantity: 100,
    factory: "ASUS",
    target: "GAMING",
    warrantyMonths: 24,
    isActive: true,
  },
  {
    id: 2,
    name: "Laptop Dell Inspiron 15",
    price: 15_490_000,
    quantity: 200,
    factory: "DELL",
    target: "SINHVIEN-VANPHONG",
    warrantyMonths: 12,
    isActive: true,
  },
  {
    id: 3,
    name: "Lenovo IdeaPad Gaming 3",
    price: 19_500_000,
    quantity: 150,
    factory: "LENOVO",
    target: "GAMING",
    warrantyMonths: 24,
    isActive: true,
  },
  {
    id: 4,
    name: "Asus K501UX",
    price: 11_900_000,
    quantity: 99,
    factory: "ASUS",
    target: "THIET-KE-DO-HOA",
    warrantyMonths: 24,
    isActive: true,
  },
  {
    id: 5,
    name: "MacBook Air 13 M1",
    price: 17_690_000,
    quantity: 99,
    factory: "APPLE",
    target: "MONG-NHE",
    warrantyMonths: 12,
    isActive: true,
  },
  {
    id: 6,
    name: "Laptop LG Gram Style",
    price: 31_490_000,
    quantity: 99,
    factory: "LG",
    target: "DOANH-NHAN",
    warrantyMonths: 12,
    isActive: true,
  },
  {
    id: 7,
    name: "MacBook Air 13 M2",
    price: 24_990_000,
    quantity: 99,
    factory: "APPLE",
    target: "MONG-NHE",
    warrantyMonths: 12,
    isActive: true,
  },
  {
    id: 8,
    name: "Laptop Acer Nitro",
    price: 23_490_000,
    quantity: 99,
    factory: "ACER",
    target: "GAMING",
    warrantyMonths: 12,
    isActive: true,
  },
  {
    id: 9,
    name: "Laptop Acer Nitro V",
    price: 26_999_000,
    quantity: 99,
    factory: "ACER",
    target: "GAMING",
    warrantyMonths: 12,
    isActive: true,
  },
  {
    id: 10,
    name: "Laptop Dell Latitude 3420",
    price: 21_399_000,
    quantity: 99,
    factory: "DELL",
    target: "MONG-NHE",
    warrantyMonths: 12,
    isActive: true,
  },
];

export const buildOrderFixture = (seed = 4) => {
  const rng = createRng(seed);
  const catalog = buildCatalog(rng, NOW, BASE_PRODUCTS, ADMIN_ID);
  const customers = buildCustomers(rng, NOW, {
    firstUserId: 3,
    userRoleId: 2,
    passwordHash: "hash",
    products: catalog.products,
  });
  const promotions = buildPromotions(rng, NOW, catalog.products, ADMIN_ID);
  const ledger = createStockLedger(
    catalog.products.map((p) => ({
      productId: p.id,
      quantity: p.openingQuantity,
      at: catalog.openingAt,
    })),
  );
  const orders = buildOrders(rng, {
    now: NOW,
    products: catalog.products,
    users: customers.users,
    adminId: ADMIN_ID,
    promotions,
    receipts: catalog.receipts,
    ledger,
  });
  return { rng, catalog, customers, promotions, ledger, orders };
};

export const time = (value: Date | string | null | undefined) =>
  value ? new Date(value).getTime() : Number.NaN;
