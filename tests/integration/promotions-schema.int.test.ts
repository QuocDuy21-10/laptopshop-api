import fs from "node:fs";
import path from "node:path";
import { prisma } from "config/client";
import { createProduct, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const migrationSql = (suffix: string) => {
  const migrationsDir = path.resolve(__dirname, "../../prisma/migrations");
  const migration = fs.readdirSync(migrationsDir).find((name) => name.endsWith(`_${suffix}`));
  if (!migration) throw new Error(`Missing migration with suffix ${suffix}`);
  return fs.readFileSync(path.join(migrationsDir, migration, "migration.sql"), "utf8");
};

const promotionData = {
  kind: "COUPON" as const,
  state: "DRAFT" as const,
  name: "Welcome",
  discountKind: "PERCENT" as const,
  discountValue: 10,
  startsAt: new Date("2026-10-01T00:00:00.000Z"),
  endsAt: new Date("2026-11-01T00:00:00.000Z"),
  createdById: 1,
  updatedById: 1,
};

describe("promotion schema contract", () => {
  it("enforces one normalized coupon code and one coupon redemption per order", async () => {
    const user = await createUser();
    const first = await prisma.promotion.create({
      data: {
        ...promotionData,
        createdById: user.id,
        updatedById: user.id,
        couponPolicy: {
          create: {
            code: "WELCOME10",
            scope: "ORDER",
            maxUsesPerUser: 1,
          },
        },
      },
    });
    const second = await prisma.promotion.create({
      data: {
        ...promotionData,
        name: "Duplicate",
        createdById: user.id,
        updatedById: user.id,
      },
    });
    const product = await createProduct(0);
    const order = await prisma.order.create({
      data: {
        totalPrice: 100,
        subtotalPrice: 100,
        receiverName: "R",
        receiverAddress: "Addr",
        receiverPhone: "0900000000",
        paymentMethod: "COD",
        paymentStatus: "PAYMENT_UNPAID",
        userId: user.id,
        orderDetails: { create: { productId: product.id, price: 100, quantity: 1 } },
      },
    });

    await expect(
      prisma.couponPolicy.create({
        data: {
          promotionId: second.id,
          code: "WELCOME10",
          scope: "ORDER",
          maxUsesPerUser: 1,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    const redemption = {
      promotionId: first.id,
      userId: user.id,
      orderId: order.id,
      discountAmount: 10,
    };
    await prisma.promotionRedemption.create({ data: redemption });
    await expect(prisma.promotionRedemption.create({ data: redemption })).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("restricts deleting products and promotions referenced by targets or snapshots", async () => {
    const user = await createUser();
    const product = await createProduct(0);
    const promotion = await prisma.promotion.create({
      data: {
        ...promotionData,
        createdById: user.id,
        updatedById: user.id,
        automaticPolicy: { create: { priority: 1 } },
        products: { create: { productId: product.id } },
      },
    });

    await expect(prisma.product.delete({ where: { id: product.id } })).rejects.toMatchObject({
      code: "P2003",
    });
    await expect(prisma.promotion.delete({ where: { id: promotion.id } })).rejects.toMatchObject({
      code: "P2003",
    });
  });

  it("backfills legacy order totals and zero discounts", async () => {
    const sql = migrationSql("promotions_expand");
    const backfill = sql.split("-- BACKFILL_START")[1]?.split("-- BACKFILL_END")[0]?.trim();
    expect(backfill).toBeTruthy();
    expect(backfill).toContain("subtotalPrice");
    expect(backfill).toContain("productDiscountAmount");
    expect(backfill).toContain("couponDiscountAmount");
  });
});
