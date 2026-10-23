const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000);

export const applyNotificationRetention = async (
  client: {
    notification: { deleteMany: (args: unknown) => Promise<{ count: number }> };
    notificationDelivery: { deleteMany: (args: unknown) => Promise<{ count: number }> };
    outboxEvent: { deleteMany: (args: unknown) => Promise<{ count: number }> };
    emailVerificationChallenge: { deleteMany: (args: unknown) => Promise<{ count: number }> };
    pushSubscription: { deleteMany: (args: unknown) => Promise<{ count: number }> };
  },
  now: Date,
) => {
  const [notifications, deliveries, outbox, challenges, subscriptions] = await Promise.all([
    client.notification.deleteMany({ where: { createdAt: { lt: daysAgo(now, 180) } } }),
    client.notificationDelivery.deleteMany({ where: { createdAt: { lt: daysAgo(now, 90) } } }),
    client.outboxEvent.deleteMany({
      where: { publishedAt: { not: null }, createdAt: { lt: daysAgo(now, 30) } },
    }),
    client.emailVerificationChallenge.deleteMany({ where: { createdAt: { lt: daysAgo(now, 7) } } }),
    client.pushSubscription.deleteMany({
      where: { disabledAt: { not: null }, createdAt: { lt: daysAgo(now, 30) } },
    }),
  ]);
  return {
    notifications: notifications.count,
    deliveries: deliveries.count,
    outbox: outbox.count,
    challenges: challenges.count,
    subscriptions: subscriptions.count,
  };
};
