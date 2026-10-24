jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import { beforeEach, describe, expect, it } from "@jest/globals";
import {
  advancePriceAlertCheckpoint,
  claimPriceAlertCheckpoint,
  completePriceAlertCheckpoint,
  failPriceAlertCheckpoint,
  getPriceAlertCheckpointSnapshot,
  parseCheckpointCursor,
} from "modules/price-alerts/price-alert.checkpoint";
import type { PriceAlertSweepStats } from "modules/price-alerts/price-alert.service";
import { prismaMock, resetPrisma } from "../../helpers/prisma";

const now = new Date("2026-10-24T01:00:00.000Z");
const stats: PriceAlertSweepStats = {
  productsScanned: 2,
  itemsEvaluated: 4,
  notificationsCreated: 1,
  duplicatesSkipped: 1,
  invalidStatesSkipped: 0,
  errors: 0,
};

const checkpointRow = {
  workerName: "price-alert-worker",
  ownerToken: "owner",
  cursor: { version: 1, lastProductId: 12 },
  cycleStartedAt: now,
  lastStartedAt: now,
  lastCompletedAt: null,
  lastSucceededAt: null,
  lastDurationMs: null,
  consecutiveFailures: 0,
  lastErrorCode: null,
  lastStats: stats,
  createdAt: now,
  updatedAt: now,
};

beforeEach(() => resetPrisma());

describe("price alert checkpoint", () => {
  it("parses only versioned non-negative product cursors", () => {
    expect(parseCheckpointCursor({ version: 1, lastProductId: 42 })).toBe(42);
    expect(parseCheckpointCursor({ version: 2, lastProductId: 42 })).toBe(0);
    expect(parseCheckpointCursor({ version: 1, lastProductId: -1 })).toBe(0);
    expect(parseCheckpointCursor(null)).toBe(0);
  });

  it("claims the existing cursor while replacing the owner token", async () => {
    prismaMock.workerCheckpoint.upsert.mockResolvedValue(checkpointRow);

    await expect(
      claimPriceAlertCheckpoint(prismaMock, { ownerToken: "new-owner", now }),
    ).resolves.toMatchObject({ checkpointProductId: 12 });
    expect(prismaMock.workerCheckpoint.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workerName: "price-alert-worker" },
        update: expect.objectContaining({ ownerToken: "new-owner", lastStartedAt: now }),
      }),
    );
  });

  it("rejects progress from a stale owner", async () => {
    prismaMock.workerCheckpoint.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      advancePriceAlertCheckpoint(prismaMock, {
        ownerToken: "stale",
        lastProductId: 42,
        stats,
      }),
    ).resolves.toBe(false);
  });

  it("returns a sanitized completed snapshot without owner token or raw cursor", async () => {
    prismaMock.workerCheckpoint.findUnique.mockResolvedValue({
      ...checkpointRow,
      cursor: { version: 1, lastProductId: 42 },
      lastSucceededAt: now,
      lastDurationMs: 1200,
    });

    const snapshot = await getPriceAlertCheckpointSnapshot(prismaMock);

    expect(snapshot).toMatchObject({
      checkpointProductId: 42,
      lastSucceededAt: now,
      lastDurationMs: 1200,
      lastStats: stats,
    });
    expect(snapshot).not.toHaveProperty("ownerToken");
    expect(snapshot).not.toHaveProperty("cursor");
  });

  it("marks a successful completion only when the owner still matches", async () => {
    prismaMock.workerCheckpoint.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      completePriceAlertCheckpoint(prismaMock, {
        ownerToken: "owner",
        now,
        durationMs: 1200,
        stats,
        successful: true,
      }),
    ).resolves.toBe(true);
    expect(prismaMock.workerCheckpoint.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workerName: "price-alert-worker", ownerToken: "owner" },
        data: expect.objectContaining({
          cursor: { version: 1, lastProductId: 0 },
          lastSucceededAt: now,
          consecutiveFailures: 0,
          ownerToken: null,
        }),
      }),
    );
  });

  it("records a failed run without taking ownership from a newer worker", async () => {
    prismaMock.workerCheckpoint.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      failPriceAlertCheckpoint(prismaMock, {
        ownerToken: "stale",
        now,
        durationMs: 300,
        errorCode: "BATCH_ERROR",
        stats: { ...stats, errors: 1 },
      }),
    ).resolves.toBe(false);
    expect(prismaMock.workerCheckpoint.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workerName: "price-alert-worker", ownerToken: "stale" },
      }),
    );
  });
});
