import { prisma } from "config/client";
import { priceAdvisorCandidates } from "modules/advisor/advisor.pricing";
import { PrismaAdvisorRepository } from "modules/advisor/advisor.repository";
import { createAdvisorService } from "modules/advisor/advisor.service";
import { createProduct, createUser, resetDb } from "./fixtures";

const now = new Date("2026-10-25T00:00:00.000Z");

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("Advisor pricing pipeline", () => {
  it("filters and ranks with Automatic Promotion while excluding Flash Sale pricing", async () => {
    const admin = await createUser();
    const discounted = await createProduct(2, 23_000_000);
    const regular = await createProduct(2, 19_000_000);
    const flashSaleOnly = await createProduct(2, 23_000_000);
    const expired = await createProduct(2, 23_000_000);
    const lowRam = await createProduct(2, 19_000_000);
    const inactive = await createProduct(2, 19_000_000);
    const outOfStock = await createProduct(0, 19_000_000);

    await prisma.product.updateMany({
      where: {
        id: {
          in: [discounted.id, regular.id, flashSaleOnly.id, expired.id, lowRam.id, inactive.id],
        },
      },
      data: { ramGb: 16 },
    });
    await prisma.product.update({ where: { id: lowRam.id }, data: { ramGb: 8 } });
    await prisma.product.update({ where: { id: inactive.id }, data: { isActive: false } });

    await prisma.promotion.create({
      data: {
        kind: "AUTOMATIC",
        state: "ACTIVE",
        name: "Budget sale",
        discountKind: "FIXED",
        discountValue: 4_000_000,
        startsAt: new Date("2026-10-01T00:00:00.000Z"),
        endsAt: new Date("2026-11-01T00:00:00.000Z"),
        createdById: admin.id,
        updatedById: admin.id,
        automaticPolicy: { create: { priority: 1, stackableWithCoupon: false } },
        products: { create: { productId: discounted.id } },
      },
    });
    await prisma.promotion.create({
      data: {
        kind: "FLASH_SALE",
        state: "ACTIVE",
        name: "Flash-only sale",
        discountKind: "FIXED",
        discountValue: 5_000_000,
        startsAt: new Date("2026-10-01T00:00:00.000Z"),
        endsAt: new Date("2026-11-01T00:00:00.000Z"),
        createdById: admin.id,
        updatedById: admin.id,
        flashSalePolicy: {
          create: {
            priority: 1,
            stackableWithCoupon: false,
            showRemainingQuota: true,
            quotas: { create: { productId: flashSaleOnly.id, totalQuota: 10, maxUnitsPerUser: 1 } },
          },
        },
      },
    });
    await prisma.promotion.create({
      data: {
        kind: "AUTOMATIC",
        state: "ACTIVE",
        name: "Expired sale",
        discountKind: "FIXED",
        discountValue: 4_000_000,
        startsAt: new Date("2026-09-01T00:00:00.000Z"),
        endsAt: new Date("2026-10-01T00:00:00.000Z"),
        createdById: admin.id,
        updatedById: admin.id,
        automaticPolicy: { create: { priority: 1, stackableWithCoupon: false } },
        products: { create: { productId: expired.id } },
      },
    });

    const result = await createAdvisorService({
      repository: new PrismaAdvisorRepository(),
      priceCandidates: priceAdvisorCandidates,
      candidateBatchSize: 1,
      clock: () => now,
    }).recommend(
      {
        budgetMax: 20_000_000,
        usage: "CODING",
        priorities: [],
        minRamGb: 16,
        workloads: [],
      },
      { kind: "guest", key: "integration-guest" },
    );

    const recommendations = result.recommendations;
    expect(recommendations.map(({ product }) => product.id)).toEqual(
      expect.arrayContaining([discounted.id, regular.id]),
    );
    expect(recommendations.map(({ product }) => product.id)).not.toEqual(
      expect.arrayContaining([flashSaleOnly.id, expired.id, lowRam.id, inactive.id, outOfStock.id]),
    );
    expect(
      recommendations.find(({ product }) => product.id === discounted.id)?.product,
    ).toMatchObject({
      price: 23_000_000,
      salePrice: 19_000_000,
      productDiscountAmount: 4_000_000,
    });
  });
});
