import { prisma } from "config/client";
import { AppError } from "lib/errors";
import {
  toNotificationPreferencesDto,
  type NotificationPreferencesDto,
} from "modules/notifications/notification-preferences.mapper";
import type { UpdateNotificationPreferencesBody } from "modules/notifications/notification-preferences.schema";

export const getNotificationPreferences = async (
  userId: number,
): Promise<NotificationPreferencesDto> => {
  const row = await prisma.notificationPreference.findUnique({ where: { userId } });
  return toNotificationPreferencesDto(row);
};

export const updateNotificationPreferences = async (
  userId: number,
  input: UpdateNotificationPreferencesBody,
): Promise<NotificationPreferencesDto> => {
  if (input.emailEnabled) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerifiedAt: true },
    });
    if (!user?.emailVerifiedAt) {
      throw new AppError("Email must be verified first", 409, "EMAIL_NOT_VERIFIED");
    }
  }
  const row = await prisma.notificationPreference.upsert({
    where: { userId },
    create: {
      userId,
      emailEnabled: input.emailEnabled ?? false,
      webPushEnabled: input.webPushEnabled ?? false,
    },
    update: {
      ...(input.emailEnabled !== undefined ? { emailEnabled: input.emailEnabled } : {}),
      ...(input.webPushEnabled !== undefined ? { webPushEnabled: input.webPushEnabled } : {}),
    },
  });
  return toNotificationPreferencesDto(row);
};

export const invalidateEmailIdentity = async (
  tx: {
    notificationPreference: { updateMany: (args: unknown) => Promise<unknown> };
    emailVerificationChallenge: { updateMany: (args: unknown) => Promise<unknown> };
    notificationDelivery: { updateMany: (args: unknown) => Promise<unknown> };
  },
  userId: number,
  previousEmail: string,
) => {
  await tx.notificationPreference.updateMany({
    where: { userId },
    data: { emailEnabled: false },
  });
  await tx.emailVerificationChallenge.updateMany({
    where: { userId, consumedAt: null, invalidatedAt: null },
    data: { invalidatedAt: new Date() },
  });
  await tx.notificationDelivery.updateMany({
    where: {
      channel: "EMAIL",
      destinationKey: previousEmail,
      status: { in: ["PENDING", "PROCESSING", "RETRYING"] },
    },
    data: { status: "SUPPRESSED", leaseOwner: null, leaseExpiresAt: null },
  });
};
