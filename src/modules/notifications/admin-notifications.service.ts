import { prisma } from "config/client";
import { AppError } from "lib/errors";
import { pageArgs, pageMeta } from "lib/http";
import { createOutboxEvent } from "modules/outbox/outbox.repository";
import { getPriceAlertCheckpointSnapshot } from "modules/price-alerts/price-alert.checkpoint";
import {
  toAdminDeliveryDto,
  toNotificationOperationsDto,
} from "modules/notifications/admin-notifications.mapper";
import type { NotificationDeliveryQuery } from "modules/notifications/admin-notifications.schema";

export const getNotificationOperations = async () => {
  const now = new Date();
  const [activeAlerts, notifications, deadDeliveries, pendingOutbox, workers, priceAlertSweep] =
    await Promise.all([
      prisma.wishlistItem.count({ where: { alertMode: { not: null } } }),
      prisma.notification.count(),
      prisma.notificationDelivery.count({ where: { status: "DEAD" } }),
      prisma.outboxEvent.count({ where: { publishedAt: null } }),
      prisma.workerHeartbeat.findMany({
        select: { workerName: true, instanceId: true, status: true, lastSeenAt: true },
        orderBy: { lastSeenAt: "desc" },
      }),
      getPriceAlertCheckpointSnapshot(prisma),
    ]);
  return toNotificationOperationsDto({
    activeAlerts,
    notifications,
    deadDeliveries,
    pendingOutbox,
    workers: workers
      .map((worker) => ({
        ...worker,
        isStale: now.getTime() - worker.lastSeenAt.getTime() > 120_000,
      }))
      .sort((a, b) =>
        a.workerName === b.workerName
          ? b.lastSeenAt.getTime() - a.lastSeenAt.getTime()
          : a.workerName.localeCompare(b.workerName),
      ),
    priceAlertSweep,
  });
};

export const listNotificationDeliveries = async (query: NotificationDeliveryQuery) => {
  const where = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.channel ? { channel: query.channel } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.notificationDelivery.count({ where }),
    prisma.notificationDelivery.findMany({
      where,
      select: {
        id: true,
        channel: true,
        status: true,
        attemptCount: true,
        normalizedErrorCode: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...pageArgs(query),
    }),
  ]);
  return { items: rows.map(toAdminDeliveryDto), meta: pageMeta(query, total) };
};

export const retryNotificationDelivery = async (actorId: number, id: number, reason: string) =>
  prisma.$transaction(async (tx) => {
    const delivery = await tx.notificationDelivery.findUnique({ where: { id } });
    if (!delivery) throw new AppError("Notification delivery not found", 404, "DELIVERY_NOT_FOUND");
    if (!["DEAD", "FAILED"].includes(delivery.status)) {
      throw new AppError("Delivery is not retryable", 409, "DELIVERY_NOT_RETRYABLE");
    }
    const updated = await tx.notificationDelivery.update({
      where: { id },
      data: {
        status: "PENDING",
        attemptCount: 0,
        nextAttemptAt: null,
        normalizedErrorCode: null,
        lastErrorAt: null,
      },
    });
    await tx.notificationDeliveryAudit.create({
      data: { deliveryId: id, actorId, action: "RETRY", reason },
    });
    await createOutboxEvent(tx, {
      eventType: "NOTIFICATION_DELIVERY_REQUESTED",
      aggregateType: "NotificationDelivery",
      aggregateId: id,
      dedupeKey: "manual-retry-" + id + "-" + Date.now(),
      payload: { deliveryId: id, manualRetry: true },
    });
    return { id: updated.id, status: updated.status };
  });
