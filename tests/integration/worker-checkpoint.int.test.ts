import { prisma } from "config/client";
import {
  advancePriceAlertCheckpoint,
  claimPriceAlertCheckpoint,
  completePriceAlertCheckpoint,
} from "modules/price-alerts/price-alert.checkpoint";
import { resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const now = new Date("2026-10-24T01:00:00.000Z");
const stats = {
  productsScanned: 1,
  itemsEvaluated: 2,
  notificationsCreated: 1,
  duplicatesSkipped: 0,
  invalidStatesSkipped: 0,
  errors: 0,
};

describe("price alert worker checkpoint", () => {
  it("resumes the cursor and fences a stale owner across restart", async () => {
    await prisma.workerCheckpoint.create({
      data: {
        workerName: "price-alert-worker",
        ownerToken: "dead-owner",
        cursor: { version: 1, lastProductId: 20 },
        cycleStartedAt: now,
        lastStartedAt: now,
      },
    });

    const resumed = await claimPriceAlertCheckpoint(prisma, {
      ownerToken: "recovery-owner",
      now: new Date(now.getTime() + 1_000),
    });
    expect(resumed.checkpointProductId).toBe(20);

    await expect(
      advancePriceAlertCheckpoint(prisma, {
        ownerToken: "dead-owner",
        lastProductId: 99,
        stats,
      }),
    ).resolves.toBe(false);
    await expect(
      advancePriceAlertCheckpoint(prisma, {
        ownerToken: "recovery-owner",
        lastProductId: 42,
        stats,
      }),
    ).resolves.toBe(true);

    const nextOwner = await claimPriceAlertCheckpoint(prisma, {
      ownerToken: "next-owner",
      now: new Date(now.getTime() + 2_000),
    });
    expect(nextOwner.checkpointProductId).toBe(42);

    await expect(
      completePriceAlertCheckpoint(prisma, {
        ownerToken: "next-owner",
        now: new Date(now.getTime() + 3_000),
        durationMs: 1_200,
        stats,
        successful: true,
      }),
    ).resolves.toBe(true);

    await expect(
      prisma.workerCheckpoint.findUnique({ where: { workerName: "price-alert-worker" } }),
    ).resolves.toMatchObject({
      ownerToken: null,
      cursor: { version: 1, lastProductId: 0 },
      lastSucceededAt: new Date(now.getTime() + 3_000),
      consecutiveFailures: 0,
    });
  });
});
