import { createHash } from "node:crypto";
import { prisma } from "config/client";
import { env } from "config/env";
import { AppError } from "lib/errors";
import { toWebPushSubscriptionDto } from "modules/notifications/web-push.mapper";
import type { WebPushSubscriptionBody } from "modules/notifications/web-push.schema";

const endpointHash = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex");

export const getWebPushConfig = () => ({
  enabled: env.WEB_PUSH_ENABLED,
  publicKey: env.VAPID_PUBLIC_KEY ?? null,
});

export const upsertWebPushSubscription = async (userId: number, input: WebPushSubscriptionBody) => {
  const hash = endpointHash(input.endpoint);
  const existing = await prisma.pushSubscription.findUnique({ where: { endpointHash: hash } });
  if (existing && existing.userId !== userId) {
    throw new AppError(
      "Push subscription is owned by another user",
      409,
      "PUSH_SUBSCRIPTION_OWNED",
    );
  }
  const row = existing
    ? await prisma.pushSubscription.update({
        where: { id: existing.id },
        data: {
          endpoint: input.endpoint,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          userAgent: input.userAgent,
          lastSeenAt: new Date(),
          disabledAt: null,
        },
      })
    : await prisma.pushSubscription.create({
        data: {
          userId,
          endpoint: input.endpoint,
          endpointHash: hash,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          userAgent: input.userAgent,
        },
      });
  return toWebPushSubscriptionDto(row);
};

export const disableWebPushSubscription = async (userId: number, id: number) => {
  const result = await prisma.pushSubscription.updateMany({
    where: { id, userId, disabledAt: null },
    data: { disabledAt: new Date() },
  });
  if (result.count !== 1)
    throw new AppError("Push subscription not found", 404, "PUSH_SUBSCRIPTION_NOT_FOUND");
};

export const disableAllWebPushSubscriptions = async (userId: number) => {
  await prisma.pushSubscription.updateMany({
    where: { userId, disabledAt: null },
    data: { disabledAt: new Date() },
  });
};
