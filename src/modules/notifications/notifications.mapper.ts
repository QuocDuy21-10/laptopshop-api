import { Prisma } from "@prisma/client";

export const notificationSelect = {
  id: true,
  productId: true,
  type: true,
  title: true,
  message: true,
  oldPrice: true,
  newPrice: true,
  priceSource: true,
  promotionId: true,
  pricingVersion: true,
  validUntil: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

export type NotificationRow = Prisma.NotificationGetPayload<{ select: typeof notificationSelect }>;

export const toNotificationDto = (row: NotificationRow) => ({
  id: row.id,
  productId: row.productId,
  type: row.type,
  title: row.title,
  message: row.message,
  oldPrice: row.oldPrice,
  newPrice: row.newPrice,
  priceSource: row.priceSource,
  promotionId: row.promotionId,
  pricingVersion: row.pricingVersion,
  validUntil: row.validUntil,
  readAt: row.readAt,
  createdAt: row.createdAt,
});
export type NotificationDto = ReturnType<typeof toNotificationDto>;
