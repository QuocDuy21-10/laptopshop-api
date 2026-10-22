import { prisma } from "config/client";
import {
  commitPriceAlertCandidate,
  runPriceAlertSweep,
  type PriceAlertCandidate,
} from "modules/price-alerts/price-alert.service";
import { createProduct, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const sweep = () =>
  runPriceAlertSweep({
    client: prisma,
    now: new Date("2026-10-22T04:00:00.000Z"),
    productBatchSize: 100,
  });

describe("price alert worker persistence", () => {
  it("creates one notification when two sweeps process the same price drop", async () => {
    const user = await createUser();
    const product = await createProduct(3, 900);
    await prisma.wishlistItem.create({
      data: {
        userId: user.id,
        productId: product.id,
        alertMode: "PERCENT_DROP",
        referencePrice: 1_000,
      },
    });

    await Promise.all([sweep(), sweep()]);

    await expect(prisma.notification.count({ where: { userId: user.id } })).resolves.toBe(1);
    await expect(
      prisma.wishlistItem.findUnique({
        where: { userId_productId: { userId: user.id, productId: product.id } },
      }),
    ).resolves.toMatchObject({
      referencePrice: 900,
      lastAlertMode: "PERCENT_DROP",
      lastAlertedPrice: 900,
    });
  });

  it("rolls back the notification when the user changes the alert before the conditional update", async () => {
    const user = await createUser();
    const product = await createProduct(3, 900);
    const item = await prisma.wishlistItem.create({
      data: {
        userId: user.id,
        productId: product.id,
        alertMode: "PERCENT_DROP",
        referencePrice: 1_000,
      },
    });
    const candidate: PriceAlertCandidate = {
      wishlistItemId: item.id,
      userId: user.id,
      productId: product.id,
      productName: product.name,
      mode: "PERCENT_DROP",
      referencePrice: 1_000,
      targetPrice: null,
      currentPrice: 900,
    };
    await prisma.wishlistItem.update({
      where: { id: item.id },
      data: { alertMode: null, referencePrice: null },
    });

    await expect(commitPriceAlertCandidate(prisma, candidate, new Date())).resolves.toBe("stale");
    await expect(prisma.notification.count({ where: { userId: user.id } })).resolves.toBe(0);
  });

  it("rejects a stale target candidate when only the target is reconfigured", async () => {
    const user = await createUser();
    const product = await createProduct(3, 800);
    const item = await prisma.wishlistItem.create({
      data: {
        userId: user.id,
        productId: product.id,
        alertMode: "TARGET_PRICE",
        targetPrice: 850,
        referencePrice: 1_000,
      },
    });
    const candidate: PriceAlertCandidate = {
      wishlistItemId: item.id,
      userId: user.id,
      productId: product.id,
      productName: product.name,
      mode: "TARGET_PRICE",
      referencePrice: 1_000,
      targetPrice: 850,
      currentPrice: 800,
    };
    await prisma.wishlistItem.update({ where: { id: item.id }, data: { targetPrice: 750 } });

    await expect(commitPriceAlertCandidate(prisma, candidate, new Date())).resolves.toBe("stale");
    await expect(prisma.notification.count({ where: { userId: user.id } })).resolves.toBe(0);
    await expect(prisma.wishlistItem.findUnique({ where: { id: item.id } })).resolves.toMatchObject(
      { targetPrice: 750 },
    );
  });

  it("advances percent reference but clears a reached target alert", async () => {
    const user = await createUser();
    const percentProduct = await createProduct(3, 900);
    const targetProduct = await createProduct(3, 800);
    await prisma.wishlistItem.create({
      data: {
        userId: user.id,
        productId: percentProduct.id,
        alertMode: "PERCENT_DROP",
        referencePrice: 1_000,
      },
    });
    await prisma.wishlistItem.create({
      data: {
        userId: user.id,
        productId: targetProduct.id,
        alertMode: "TARGET_PRICE",
        targetPrice: 850,
        referencePrice: 1_000,
      },
    });

    await sweep();

    await expect(
      prisma.wishlistItem.findUnique({
        where: { userId_productId: { userId: user.id, productId: percentProduct.id } },
      }),
    ).resolves.toMatchObject({
      alertMode: "PERCENT_DROP",
      referencePrice: 900,
      lastAlertMode: "PERCENT_DROP",
    });
    await expect(
      prisma.wishlistItem.findUnique({
        where: { userId_productId: { userId: user.id, productId: targetProduct.id } },
      }),
    ).resolves.toMatchObject({
      alertMode: null,
      targetPrice: null,
      referencePrice: null,
      lastAlertMode: "TARGET_PRICE",
    });
  });

  it("uses automatic promotion pricing and excludes Flash Sale pricing", async () => {
    const user = await createUser();
    const product = await createProduct(3, 1_000);
    await prisma.wishlistItem.create({
      data: {
        userId: user.id,
        productId: product.id,
        alertMode: "PERCENT_DROP",
        referencePrice: 1_000,
      },
    });
    const now = new Date("2026-10-22T04:00:00.000Z");
    await prisma.promotion.create({
      data: {
        kind: "AUTOMATIC",
        state: "ACTIVE",
        name: "Automatic 10%",
        discountKind: "PERCENT",
        discountValue: 10,
        startsAt: new Date("2026-10-21T00:00:00.000Z"),
        endsAt: new Date("2026-10-23T00:00:00.000Z"),
        createdById: user.id,
        updatedById: user.id,
        automaticPolicy: { create: { priority: 1 } },
        products: { create: { productId: product.id } },
      },
    });
    await prisma.promotion.create({
      data: {
        kind: "FLASH_SALE",
        state: "ACTIVE",
        name: "Flash 50%",
        discountKind: "PERCENT",
        discountValue: 50,
        startsAt: new Date("2026-10-21T00:00:00.000Z"),
        endsAt: new Date("2026-10-23T00:00:00.000Z"),
        createdById: user.id,
        updatedById: user.id,
        flashSalePolicy: { create: {} },
        flashSaleQuotas: { create: { productId: product.id, totalQuota: 1, maxUnitsPerUser: 1 } },
      },
    });

    await runPriceAlertSweep({ client: prisma, now, productBatchSize: 100 });

    await expect(
      prisma.notification.findFirst({ where: { userId: user.id } }),
    ).resolves.toMatchObject({
      oldPrice: 1_000,
      newPrice: 900,
    });
  });
});
