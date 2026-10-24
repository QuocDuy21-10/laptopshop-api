import { Prisma } from "@prisma/client";
import { prisma } from "config/client";
import { isUniqueViolation } from "lib/errors";
import { logger } from "lib/logger";
import type { PriceAlertSweepStats } from "modules/price-alerts/price-alert.service";

export const PRICE_ALERT_WORKER_NAME = "price-alert-worker";
const CURSOR_VERSION = 1;
class CheckpointOwnershipLost extends Error {}

export type PriceAlertCheckpointCursor = {
  version: 1;
  lastProductId: number;
};

export type PriceAlertCheckpointSnapshot = {
  checkpointProductId: number;
  cycleStartedAt: Date | null;
  lastStartedAt: Date | null;
  lastCompletedAt: Date | null;
  lastSucceededAt: Date | null;
  lastDurationMs: number | null;
  consecutiveFailures: number;
  lastErrorCode: string | null;
  lastStats: PriceAlertSweepStats | null;
  updatedAt: Date;
};

type CheckpointClient = typeof prisma;
type CheckpointRow = Awaited<ReturnType<CheckpointClient["workerCheckpoint"]["findUnique"]>>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isValidCursor = (value: unknown): value is PriceAlertCheckpointCursor =>
  isRecord(value) &&
  value.version === CURSOR_VERSION &&
  typeof value.lastProductId === "number" &&
  Number.isInteger(value.lastProductId) &&
  value.lastProductId >= 0;

export const parseCheckpointCursor = (value: unknown): number =>
  isValidCursor(value) ? value.lastProductId : 0;

const toJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

const isSweepStats = (value: unknown): value is PriceAlertSweepStats =>
  isRecord(value) &&
  [
    "productsScanned",
    "itemsEvaluated",
    "notificationsCreated",
    "duplicatesSkipped",
    "invalidStatesSkipped",
    "errors",
  ].every((key) => typeof value[key] === "number" && Number.isFinite(value[key]));

const mapSnapshot = (row: NonNullable<CheckpointRow>): PriceAlertCheckpointSnapshot => ({
  checkpointProductId: parseCheckpointCursor(row.cursor),
  cycleStartedAt: row.cycleStartedAt,
  lastStartedAt: row.lastStartedAt,
  lastCompletedAt: row.lastCompletedAt,
  lastSucceededAt: row.lastSucceededAt,
  lastDurationMs: row.lastDurationMs,
  consecutiveFailures: row.consecutiveFailures,
  lastErrorCode: row.lastErrorCode,
  lastStats: isSweepStats(row.lastStats) ? row.lastStats : null,
  updatedAt: row.updatedAt,
});

export const claimPriceAlertCheckpoint = async (
  client: CheckpointClient,
  input: { ownerToken: string; now: Date },
  attempt = 0,
): Promise<PriceAlertCheckpointSnapshot> => {
  const existing = await client.workerCheckpoint.findUnique({
    where: { workerName: PRICE_ALERT_WORKER_NAME },
  });
  const checkpointProductId = parseCheckpointCursor(existing?.cursor);
  if (
    existing?.cursor !== null &&
    existing?.cursor !== undefined &&
    !isValidCursor(existing.cursor)
  ) {
    logger.warn(
      { workerName: PRICE_ALERT_WORKER_NAME },
      "price alert checkpoint cursor is invalid; restarting from zero",
    );
  }
  if (!existing) {
    try {
      const row = await client.workerCheckpoint.create({
        data: {
          workerName: PRICE_ALERT_WORKER_NAME,
          ownerEpoch: 1,
          ownerToken: input.ownerToken,
          cursor: toJson({ version: CURSOR_VERSION, lastProductId: checkpointProductId }),
          cycleStartedAt: input.now,
          lastStartedAt: input.now,
        },
      });
      return mapSnapshot(row);
    } catch (error) {
      if (isUniqueViolation(error) && attempt < 1) {
        return claimPriceAlertCheckpoint(client, input, attempt + 1);
      }
      throw error;
    }
  }

  const expectedEpoch = existing.ownerEpoch;
  const claimed = await client.workerCheckpoint.updateMany({
    where: { workerName: PRICE_ALERT_WORKER_NAME, ownerEpoch: expectedEpoch },
    data: {
      ownerEpoch: expectedEpoch + 1,
      ownerToken: input.ownerToken,
      cursor: toJson({ version: CURSOR_VERSION, lastProductId: checkpointProductId }),
      cycleStartedAt: checkpointProductId > 0 ? (existing.cycleStartedAt ?? input.now) : input.now,
      lastStartedAt: input.now,
    },
  });
  if (claimed.count !== 1)
    throw new CheckpointOwnershipLost("Price alert checkpoint ownership changed");
  const claimedRow = await client.workerCheckpoint.findUnique({
    where: { workerName: PRICE_ALERT_WORKER_NAME },
  });
  if (!claimedRow) throw new CheckpointOwnershipLost("Price alert checkpoint disappeared");
  return mapSnapshot(claimedRow);
};

export const advancePriceAlertCheckpoint = async (
  client: CheckpointClient,
  input: { ownerToken: string; lastProductId: number; stats: PriceAlertSweepStats },
): Promise<boolean> => {
  const result = await client.workerCheckpoint.updateMany({
    where: { workerName: PRICE_ALERT_WORKER_NAME, ownerToken: input.ownerToken },
    data: {
      cursor: toJson({ version: CURSOR_VERSION, lastProductId: input.lastProductId }),
      lastStats: toJson(input.stats),
    },
  });
  return result.count === 1;
};

export const completePriceAlertCheckpoint = async (
  client: CheckpointClient,
  input: {
    ownerToken: string;
    now: Date;
    durationMs: number;
    stats: PriceAlertSweepStats;
    successful: boolean;
  },
): Promise<boolean> => {
  const result = await client.workerCheckpoint.updateMany({
    where: { workerName: PRICE_ALERT_WORKER_NAME, ownerToken: input.ownerToken },
    data: {
      ownerToken: null,
      cursor: toJson({ version: CURSOR_VERSION, lastProductId: 0 }),
      lastCompletedAt: input.now,
      lastDurationMs: input.durationMs,
      lastStats: toJson(input.stats),
      ...(input.successful
        ? { lastSucceededAt: input.now, consecutiveFailures: 0, lastErrorCode: null }
        : { consecutiveFailures: { increment: 1 }, lastErrorCode: "SWEEP_ERRORS" }),
    },
  });
  return result.count === 1;
};

export const failPriceAlertCheckpoint = async (
  client: CheckpointClient,
  input: {
    ownerToken: string;
    now: Date;
    durationMs: number;
    errorCode: string;
    stats: PriceAlertSweepStats;
  },
): Promise<boolean> => {
  const result = await client.workerCheckpoint.updateMany({
    where: { workerName: PRICE_ALERT_WORKER_NAME, ownerToken: input.ownerToken },
    data: {
      ownerToken: null,
      lastDurationMs: input.durationMs,
      lastErrorCode: input.errorCode,
      lastStats: toJson(input.stats),
      consecutiveFailures: { increment: 1 },
    },
  });
  return result.count === 1;
};

export const getPriceAlertCheckpointSnapshot = async (
  client: CheckpointClient,
): Promise<PriceAlertCheckpointSnapshot | null> => {
  const row = await client.workerCheckpoint.findUnique({
    where: { workerName: PRICE_ALERT_WORKER_NAME },
  });
  return row ? mapSnapshot(row) : null;
};
