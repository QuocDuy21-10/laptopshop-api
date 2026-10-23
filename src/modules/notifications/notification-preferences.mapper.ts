type PreferenceRow = {
  emailEnabled: boolean;
  webPushEnabled: boolean;
  afterSalesEmailEnabled: boolean;
  afterSalesWebPushEnabled: boolean;
};

export const toNotificationPreferencesDto = (row: PreferenceRow | null) => ({
  inAppEnabled: true,
  emailEnabled: row?.emailEnabled ?? false,
  webPushEnabled: row?.webPushEnabled ?? false,
  afterSalesEmailEnabled: row?.afterSalesEmailEnabled ?? true,
  afterSalesWebPushEnabled: row?.afterSalesWebPushEnabled ?? true,
});

export type NotificationPreferencesDto = ReturnType<typeof toNotificationPreferencesDto>;
