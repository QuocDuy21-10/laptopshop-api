import { env } from "config/env";
import { decryptEmailOtp } from "modules/email-verification/email-otp.crypto";
import {
  renderEmailVerification,
  renderAfterSalesEmail,
  renderPriceAlertEmail,
} from "modules/notifications/notification-template";
import type {
  DeliveryProcessResult,
  DeliveryProviderRegistry,
  DeliveryRecord,
} from "modules/notifications/notification-delivery.types";

type DeliveryClient = {
  notificationDelivery: {
    findUnique: (args: unknown) => Promise<DeliveryRecord | null>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
  pushSubscription?: { updateMany: (args: unknown) => Promise<unknown> };
};
type DeliveryDeps = {
  client: DeliveryClient;
  providers: DeliveryProviderRegistry;
  now: Date | (() => Date);
  leaseOwner: string;
  maxAttempts: number;
};
const terminal = new Set(["DELIVERED", "CANCELLED", "SUPPRESSED"]);
const preferenceFor = (d: DeliveryRecord) =>
  d.notification?.user?.notificationPreference ?? d.preference ?? null;
const userFor = (d: DeliveryRecord) => d.notification?.user ?? d.user ?? null;
const isConsented = (d: DeliveryRecord) => {
  if (d.emailVerificationChallengeId)
    return Boolean(
      d.emailVerificationChallenge?.email === d.destinationKey &&
      !d.emailVerificationChallenge.consumedAt &&
      !d.emailVerificationChallenge.invalidatedAt,
    );
  if (d.channel === "EMAIL") {
    const u = userFor(d);
    return Boolean(
      preferenceFor(d)?.emailEnabled && u?.emailVerifiedAt && u.username === d.destinationKey,
    );
  }
  return Boolean(preferenceFor(d)?.webPushEnabled && d.pushSubscription?.disabledAt === null);
};
const errorCode = (e: unknown) =>
  e && typeof e === "object" && "code" in e && typeof e.code === "string"
    ? e.code
    : "DELIVERY_PROVIDER_ERROR";
const retryable = (e: unknown) =>
  Boolean(e && typeof e === "object" && "retryable" in e && e.retryable === true);
const providerInput = (d: DeliveryRecord) => {
  if (d.channel === "WEB_PUSH" && d.pushSubscription && d.notification)
    return {
      destinationKey: d.destinationKey,
      pushSubscription: d.pushSubscription,
      payload: {
        notificationId: d.notification.id,
        title: d.notification.title,
        body: d.notification.message,
        url: d.notification.serviceRequestId
          ? `/account/after-sales/${d.notification.serviceRequestId}`
          : d.notification.productId
            ? `/products/${d.notification.productId}`
            : "/account/notifications",
        tag: d.notification.serviceRequestId
          ? `after-sales-${d.notification.id}`
          : `price-alert-${d.notification.id}`,
        renotify: false,
        validUntil: d.notification.validUntil,
      },
    };
  if (
    d.channel === "EMAIL" &&
    d.emailVerificationChallengeId &&
    d.emailVerificationChallenge &&
    env.EMAIL_OTP_ENCRYPTION_KEY
  ) {
    const c = decryptEmailOtp(
      {
        otpCiphertext: d.emailVerificationChallenge.otpCiphertext ?? "",
        otpIv: d.emailVerificationChallenge.otpIv ?? "",
        otpTag: d.emailVerificationChallenge.otpTag ?? "",
        encryptionKeyVersion:
          d.emailVerificationChallenge.encryptionKeyVersion ?? env.EMAIL_OTP_KEY_VERSION,
      },
      env.EMAIL_OTP_ENCRYPTION_KEY,
    );
    return {
      to: d.destinationKey,
      ...renderEmailVerification({ code: c, expiresMinutes: 10 }),
      idempotencyKey: `delivery-${d.id}`,
    };
  }
  if (d.channel === "EMAIL" && d.notification) {
    const n = d.notification;
    if (n.serviceRequestId)
      return {
        to: d.destinationKey,
        ...renderAfterSalesEmail({
          title: n.title,
          message: n.message,
          requestId: n.serviceRequestId,
        }),
        idempotencyKey: `delivery-${d.id}`,
      };
    return {
      to: d.destinationKey,
      ...renderPriceAlertEmail({
        productName: n.title,
        oldPrice: n.oldPrice ?? 0,
        newPrice: n.newPrice ?? 0,
        source: n.priceSource ?? "UNKNOWN",
        validUntil: n.validUntil,
        productUrl: n.productId ? `/products/${n.productId}` : "/account/notifications",
        settingsUrl: "/account/notifications/settings",
      }),
      idempotencyKey: `delivery-${d.id}`,
    };
  }
  return d;
};

export const processNotificationDelivery = async (
  deps: DeliveryDeps,
  deliveryId: number,
): Promise<DeliveryProcessResult> => {
  const now = typeof deps.now === "function" ? deps.now() : deps.now;
  const delivery = await deps.client.notificationDelivery.findUnique({
    where: { id: deliveryId },
    include: {
      notification: { include: { user: { include: { notificationPreference: true } } } },
      pushSubscription: true,
      emailVerificationChallenge: true,
    },
  });
  if (!delivery) return "missing";
  if (terminal.has(delivery.status)) return "noop";
  const claimed = await deps.client.notificationDelivery.updateMany({
    where: {
      id: delivery.id,
      status: { in: ["PENDING", "RETRYING", "PROCESSING"] },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
    },
    data: {
      status: "PROCESSING",
      leaseOwner: deps.leaseOwner,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
    },
  });
  if (claimed.count !== 1) return "noop";
  const current =
    (await deps.client.notificationDelivery.findUnique({
      where: { id: delivery.id },
      include: {
        notification: { include: { user: { include: { notificationPreference: true } } } },
        pushSubscription: true,
        emailVerificationChallenge: true,
      },
    })) ?? delivery;
  if (!isConsented(current)) {
    await deps.client.notificationDelivery.updateMany({
      where: { id: delivery.id, leaseOwner: deps.leaseOwner },
      data: { status: "SUPPRESSED", leaseOwner: null, leaseExpiresAt: null },
    });
    return "suppressed";
  }
  const provider = deps.providers[current.channel];
  if (!provider) {
    await deps.client.notificationDelivery.updateMany({
      where: { id: delivery.id, leaseOwner: deps.leaseOwner },
      data: {
        status: "FAILED",
        normalizedErrorCode: "DELIVERY_PROVIDER_UNAVAILABLE",
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    return "failed";
  }
  const attemptCount = current.attemptCount + 1;
  try {
    const result = await provider.send(providerInput(current));
    await deps.client.notificationDelivery.updateMany({
      where: { id: current.id, leaseOwner: deps.leaseOwner },
      data: {
        status: "DELIVERED",
        attemptCount,
        providerMessageId: result.providerMessageId,
        deliveredAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    return "delivered";
  } catch (error) {
    const code = errorCode(error);
    if (code === "PUSH_SUBSCRIPTION_GONE")
      await deps.client.pushSubscription?.updateMany({
        where: { id: current.pushSubscriptionId ?? undefined },
        data: { disabledAt: now },
      });
    const dead = !retryable(error) || attemptCount >= deps.maxAttempts;
    await deps.client.notificationDelivery.updateMany({
      where: { id: current.id, leaseOwner: deps.leaseOwner },
      data: {
        status: dead ? (retryable(error) ? "DEAD" : "FAILED") : "RETRYING",
        attemptCount,
        normalizedErrorCode: code,
        lastErrorAt: now,
        nextAttemptAt: dead
          ? null
          : new Date(now.getTime() + Math.min(3_600_000, 1_000 * 2 ** attemptCount)),
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    return dead ? (retryable(error) ? "dead" : "failed") : "retrying";
  }
};
