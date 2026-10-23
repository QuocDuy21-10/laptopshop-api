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
};

type DeliveryDeps = {
  client: DeliveryClient;
  providers: DeliveryProviderRegistry;
  now: Date;
  leaseOwner: string;
  maxAttempts: number;
};

const terminal = new Set(["DELIVERED", "CANCELLED", "SUPPRESSED"]);

const isConsented = (delivery: DeliveryRecord) => {
  if (delivery.emailVerificationChallengeId) {
    return Boolean(
      delivery.emailVerificationChallenge?.email === delivery.destinationKey &&
      !delivery.emailVerificationChallenge.consumedAt &&
      !delivery.emailVerificationChallenge.invalidatedAt,
    );
  }
  if (delivery.channel === "EMAIL") {
    return Boolean(
      delivery.preference?.emailEnabled &&
      delivery.user?.emailVerifiedAt &&
      delivery.user.username === delivery.destinationKey,
    );
  }
  return Boolean(
    delivery.preference?.webPushEnabled && delivery.pushSubscription?.disabledAt === null,
  );
};

const errorCode = (error: unknown) =>
  error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : "DELIVERY_PROVIDER_ERROR";

const retryable = (error: unknown) =>
  Boolean(error && typeof error === "object" && "retryable" in error && error.retryable === true);

export const processNotificationDelivery = async (
  deps: DeliveryDeps,
  deliveryId: number,
): Promise<DeliveryProcessResult> => {
  const delivery = await deps.client.notificationDelivery.findUnique({
    where: { id: deliveryId },
    include: {
      preference: true,
      user: true,
      pushSubscription: true,
      emailVerificationChallenge: true,
    },
  });
  if (!delivery) return "missing";
  if (terminal.has(delivery.status)) return "noop";

  const claimed = await deps.client.notificationDelivery.updateMany({
    where: {
      id: delivery.id,
      status: { in: ["PENDING", "RETRYING"] },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: deps.now } }],
    },
    data: {
      status: "PROCESSING",
      leaseOwner: deps.leaseOwner,
      leaseExpiresAt: new Date(deps.now.getTime() + 60_000),
    },
  });
  if (claimed.count !== 1) return "noop";

  if (!isConsented(delivery)) {
    await deps.client.notificationDelivery.updateMany({
      where: { id: delivery.id, leaseOwner: deps.leaseOwner },
      data: { status: "SUPPRESSED", leaseOwner: null, leaseExpiresAt: null },
    });
    return "suppressed";
  }

  const provider = deps.providers[delivery.channel];
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

  const attemptCount = delivery.attemptCount + 1;
  try {
    const result = await provider.send(delivery);
    await deps.client.notificationDelivery.updateMany({
      where: { id: delivery.id, leaseOwner: deps.leaseOwner },
      data: {
        status: "DELIVERED",
        attemptCount,
        providerMessageId: result.providerMessageId,
        deliveredAt: deps.now,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    return "delivered";
  } catch (error) {
    const code = errorCode(error);
    const dead = !retryable(error) || attemptCount >= deps.maxAttempts;
    await deps.client.notificationDelivery.updateMany({
      where: { id: delivery.id, leaseOwner: deps.leaseOwner },
      data: {
        status: dead ? (retryable(error) ? "DEAD" : "FAILED") : "RETRYING",
        attemptCount,
        normalizedErrorCode: code,
        lastErrorAt: deps.now,
        nextAttemptAt: dead
          ? null
          : new Date(deps.now.getTime() + Math.min(3_600_000, 1_000 * 2 ** attemptCount)),
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    return dead ? (retryable(error) ? "dead" : "failed") : "retrying";
  }
};
