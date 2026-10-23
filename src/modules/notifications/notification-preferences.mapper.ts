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
  afterSalesEmailEnabled: row?.afterSalesEmailEnabled ?? false,
  afterSalesWebPushEnabled: row?.afterSalesWebPushEnabled ?? false,
});

export type NotificationPreferencesDto = ReturnType<typeof toNotificationPreferencesDto>;
