import { prisma } from "config/client";
import { AppError } from "lib/errors";
import { pageArgs, pageMeta, type PageQuery } from "lib/http";
import {
  notificationSelect,
  toNotificationDto,
  type NotificationDto,
} from "modules/notifications/notifications.mapper";

const notificationNotFound = () =>
  new AppError("Notification not found", 404, "NOTIFICATION_NOT_FOUND");

export const listNotifications = async (userId: number, query: PageQuery) => {
  const where = { userId };
  const [total, rows] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      select: notificationSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...pageArgs(query),
    }),
  ]);
  return {
    items: rows.map(toNotificationDto),
    meta: pageMeta(query, total),
  };
};

export const getUnreadNotificationCount = async (userId: number) => ({
  unreadCount: await prisma.notification.count({ where: { userId, readAt: null } }),
});

const findNotification = (userId: number, id: number) =>
  prisma.notification.findFirst({ where: { id, userId }, select: notificationSelect });

export const markNotificationRead = async (
  userId: number,
  id: number,
  now = new Date(),
): Promise<NotificationDto> => {
  await prisma.notification.updateMany({
    where: { id, userId, readAt: null },
    data: { readAt: now },
  });
  const row = await findNotification(userId, id);
  if (!row) throw notificationNotFound();
  return toNotificationDto(row);
};

export const markAllNotificationsRead = async (userId: number, now = new Date()) => {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: now },
  });
  return { updatedCount: result.count };
};

export type { NotificationDto };
