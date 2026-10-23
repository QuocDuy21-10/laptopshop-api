type PushSubscriptionRow = {
  id: number;
  userAgent: string | null;
  lastSeenAt: Date;
  disabledAt: Date | null;
};

export const toWebPushSubscriptionDto = (row: PushSubscriptionRow) => ({
  id: row.id,
  userAgent: row.userAgent,
  lastSeenAt: row.lastSeenAt,
  disabledAt: row.disabledAt,
});

export type WebPushSubscriptionDto = ReturnType<typeof toWebPushSubscriptionDto>;
