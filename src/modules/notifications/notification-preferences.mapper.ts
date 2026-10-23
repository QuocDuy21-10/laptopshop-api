type PreferenceRow = { emailEnabled: boolean; webPushEnabled: boolean };

export const toNotificationPreferencesDto = (row: PreferenceRow | null) => ({
  inAppEnabled: true,
  emailEnabled: row?.emailEnabled ?? false,
  webPushEnabled: row?.webPushEnabled ?? false,
});

export type NotificationPreferencesDto = ReturnType<typeof toNotificationPreferencesDto>;
