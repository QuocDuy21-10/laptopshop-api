import { processNotificationDelivery } from "modules/notifications/notification-delivery.service";

const baseDelivery = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  channel: "EMAIL" as const,
  status: "PENDING" as const,
  attemptCount: 0,
  destinationKey: "user@example.test",
  destinationSnapshot: null,
  notificationId: 1,
  emailVerificationChallengeId: null,
  preference: { emailEnabled: true, webPushEnabled: false },
  user: { username: "user@example.test", emailVerifiedAt: new Date() },
  pushSubscription: null,
  ...overrides,
});

const deps = (delivery: Record<string, unknown>, provider: { send: jest.Mock }) => {
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  return {
    client: {
      notificationDelivery: {
        findUnique: jest.fn().mockResolvedValue(delivery),
        updateMany,
      },
    },
    providers: { EMAIL: provider },
    now: new Date("2026-10-23T00:00:00.000Z"),
    leaseOwner: "worker-1",
    maxAttempts: 5,
  };
};

describe("processNotificationDelivery", () => {
  it.each(["DELIVERED", "CANCELLED", "SUPPRESSED"])(
    "does not call the provider for terminal %s deliveries",
    async (status) => {
      const provider = { send: jest.fn() };
      await expect(
        processNotificationDelivery(deps(baseDelivery({ status }), provider), 7),
      ).resolves.toBe("noop");
      expect(provider.send).not.toHaveBeenCalled();
    },
  );

  it("suppresses a delivery when the user opted out before send", async () => {
    const provider = { send: jest.fn() };
    const runtime = deps(
      baseDelivery({ preference: { emailEnabled: false, webPushEnabled: false } }),
      provider,
    );

    await expect(processNotificationDelivery(runtime, 7)).resolves.toBe("suppressed");
    expect(provider.send).not.toHaveBeenCalled();
    expect(runtime.client.notificationDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SUPPRESSED" }) }),
    );
  });

  it("marks a successful provider call as delivered with its message id", async () => {
    const provider = { send: jest.fn().mockResolvedValue({ providerMessageId: "mail-7" }) };
    const runtime = deps(baseDelivery(), provider);

    await expect(processNotificationDelivery(runtime, 7)).resolves.toBe("delivered");
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(runtime.client.notificationDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "DELIVERED", providerMessageId: "mail-7" }),
      }),
    );
  });

  it("retries transient errors and dead-letters the fifth attempt", async () => {
    const transient = Object.assign(new Error("timeout"), { retryable: true });
    const provider = { send: jest.fn().mockRejectedValue(transient) };
    const runtime = deps(baseDelivery({ attemptCount: 0 }), provider);

    await expect(processNotificationDelivery(runtime, 7)).resolves.toBe("retrying");
    expect(runtime.client.notificationDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "RETRYING" }) }),
    );

    const deadRuntime = deps(baseDelivery({ attemptCount: 4 }), provider);
    await expect(processNotificationDelivery(deadRuntime, 7)).resolves.toBe("dead");
    expect(deadRuntime.client.notificationDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "DEAD" }) }),
    );
  });

  it("marks permanent provider errors as failed without retry", async () => {
    const permanent = Object.assign(new Error("rejected"), {
      retryable: false,
      code: "INVALID_DESTINATION",
    });
    const provider = { send: jest.fn().mockRejectedValue(permanent) };
    const runtime = deps(baseDelivery(), provider);

    await expect(processNotificationDelivery(runtime, 7)).resolves.toBe("failed");
    expect(runtime.client.notificationDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          normalizedErrorCode: "INVALID_DESTINATION",
        }),
      }),
    );
  });
});
