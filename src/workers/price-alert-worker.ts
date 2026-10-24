import "../instrument";
import { randomUUID } from "crypto";
import { prisma } from "config/client";
import { env } from "config/env";
import { createRedisClient } from "config/redis";
import { logger } from "lib/logger";
import {
  runLockedPriceAlertSweep,
  type LockedPriceAlertSweepResult,
} from "modules/price-alerts/price-alert.runner";
import {
  getPriceAlertCheckpointSnapshot,
  type PriceAlertCheckpointSnapshot,
} from "modules/price-alerts/price-alert.checkpoint";
import { evaluatePricingEvent } from "modules/price-alerts/price-alert.service";
import { recordWorkerHeartbeat } from "modules/workers/worker-heartbeat.service";
import { createBullMqRedisClient, createWorker } from "queues/queue.factory";
import { PRICING_QUEUE_NAME, type PricingEvaluationJob } from "queues/pricing.queue";

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export type WorkerHeartbeatStatus = "RUNNING" | "HEALTHY" | "DEGRADED" | "STOPPING";

export const createSerializedHeartbeatReporter = (input: {
  instanceId: string;
  recordHeartbeat: (
    status: WorkerHeartbeatStatus,
    metadata?: Record<string, unknown>,
  ) => Promise<unknown>;
}) => {
  let state: { status: WorkerHeartbeatStatus; metadata: Record<string, unknown> } = {
    status: "HEALTHY",
    metadata: { instanceId: input.instanceId, activity: "idle" },
  };
  let pending: Promise<unknown> = Promise.resolve();
  const report = (status: WorkerHeartbeatStatus, metadata: Record<string, unknown> = {}) => {
    const next = { status, metadata: { instanceId: input.instanceId, ...metadata } };
    state = next;
    pending = pending
      .catch(() => undefined)
      .then(() => input.recordHeartbeat(next.status, next.metadata));
    return pending;
  };
  return {
    report,
    refresh: () => report(state.status, { ...state.metadata, activity: "heartbeat" }),
    stop: () => report("STOPPING", { ...state.metadata, activity: "shutdown" }),
  };
};

export type PriceAlertWorkerIterationDeps = {
  instanceId: string;
  now: () => Date;
  runSweep: () => Promise<LockedPriceAlertSweepResult>;
  recordHeartbeat: (
    status: WorkerHeartbeatStatus,
    metadata?: Record<string, unknown>,
  ) => Promise<unknown>;
  getCheckpoint: () => Promise<PriceAlertCheckpointSnapshot | null>;
};

export const runPriceAlertWorkerIteration = async (
  deps: PriceAlertWorkerIterationDeps,
): Promise<LockedPriceAlertSweepResult> => {
  await deps.recordHeartbeat("RUNNING", {
    instanceId: deps.instanceId,
    activity: "reconciliation",
  });
  try {
    const result = await deps.runSweep();
    let checkpoint: PriceAlertCheckpointSnapshot | null = null;
    try {
      checkpoint = await deps.getCheckpoint();
    } catch (error) {
      logger.error({ error }, "price alert checkpoint metrics unavailable");
    }
    const metadata: Record<string, unknown> = {
      instanceId: deps.instanceId,
      activity: "reconciliation",
      checkpointProductId: checkpoint?.checkpointProductId ?? null,
      reason: result.kind === "RAN" ? result.sweep.stopReason : result.reason,
    };
    if (result.kind === "RAN") metadata.stats = result.sweep.stats;
    const healthy =
      result.kind === "SKIPPED" ||
      (result.kind === "RAN" && result.sweep.completed && result.sweep.stats.errors === 0);
    await deps.recordHeartbeat(healthy ? "HEALTHY" : "DEGRADED", metadata);
    return result;
  } catch (error) {
    await deps.recordHeartbeat("DEGRADED", {
      instanceId: deps.instanceId,
      activity: "reconciliation",
      reason: "SWEEP_FAILED",
    });
    throw error;
  }
};

const main = async () => {
  const instanceId = randomUUID();
  const redis = createRedisClient(env.REDIS_URL);
  await redis.connect();
  const queueConnection = env.NOTIFICATION_OUTBOX_ENABLED
    ? await createBullMqRedisClient(env.REDIS_URL)
    : null;
  const pricingWorker = queueConnection
    ? createWorker<PricingEvaluationJob>(
        PRICING_QUEUE_NAME,
        async (job) =>
          evaluatePricingEvent(
            prisma,
            job.data,
            new Date(),
            env.PRICE_ALERT_PRODUCT_BATCH_SIZE,
            env.PRICE_ALERT_ITEM_BATCH_SIZE,
          ),
        queueConnection,
        env.NOTIFICATION_QUEUE_PREFIX,
        { concurrency: 1 },
      )
    : null;
  let stopping = false;
  let stopResolve!: () => void;
  const stopped = new Promise<void>((resolve) => {
    stopResolve = resolve;
  });
  const heartbeatReporter = createSerializedHeartbeatReporter({
    instanceId,
    recordHeartbeat: (status, metadata) =>
      recordWorkerHeartbeat(prisma, "price-alert-worker", instanceId, status, metadata),
  });
  const heartbeat = setInterval(() => {
    void heartbeatReporter
      .refresh()
      .catch((error) => logger.error({ error }, "price alert heartbeat failed"));
  }, 60_000);
  heartbeat.unref();

  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    stopResolve();
    logger.info("price alert worker shutting down");
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  try {
    while (!stopping) {
      await runPriceAlertWorkerIteration({
        instanceId,
        now: () => new Date(),
        runSweep: () =>
          runLockedPriceAlertSweep({
            redis,
            client: prisma,
            now: () => new Date(),
            productBatchSize: env.PRICE_ALERT_PRODUCT_BATCH_SIZE,
            itemBatchSize: env.PRICE_ALERT_ITEM_BATCH_SIZE,
            lockTtlMs: env.PRICE_ALERT_LOCK_TTL_MS,
            token: randomUUID,
            logger,
          }),
        recordHeartbeat: (status, metadata) => heartbeatReporter.report(status, metadata),
        getCheckpoint: () => getPriceAlertCheckpointSnapshot(prisma),
      });
      if (!stopping) await Promise.race([delay(env.PRICE_ALERT_INTERVAL_MS), stopped]);
    }
  } finally {
    clearInterval(heartbeat);
    await heartbeatReporter
      .stop()
      .catch((error) => logger.error({ error }, "price alert stop heartbeat failed"));
    await pricingWorker?.close();
    await queueConnection?.disconnect();
    await Promise.allSettled([redis.quit(), prisma.$disconnect()]);
  }
};

if (require.main === module && !process.env.JEST_WORKER_ID) {
  main().catch((error) => {
    logger.error({ error }, "price alert worker failed");
    process.exit(1);
  });
}
