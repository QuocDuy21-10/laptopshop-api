import type { PriceAlertCheckpointSnapshot } from "modules/price-alerts/price-alert.checkpoint";

export const toNotificationOperationsDto = (input: {
  activeAlerts: number;
  notifications: number;
  deadDeliveries: number;
  pendingOutbox: number;
  workers: Array<{
    workerName: string;
    instanceId: string;
    status: string;
    lastSeenAt: Date;
    isStale: boolean;
  }>;
  priceAlertSweep: PriceAlertCheckpointSnapshot | null;
}) => input;

export const toAdminDeliveryDto = (row: {
  id: number;
  channel: string;
  status: string;
  attemptCount: number;
  normalizedErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: row.id,
  channel: row.channel,
  status: row.status,
  attemptCount: row.attemptCount,
  normalizedErrorCode: row.normalizedErrorCode,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});
