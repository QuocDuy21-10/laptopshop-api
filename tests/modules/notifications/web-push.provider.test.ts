jest.mock("web-push", () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

import webpush from "web-push";
import { createWebPushProvider } from "modules/notifications/providers/web-push.provider";

const input = {
  destinationKey: "hash",
  pushSubscription: {
    endpoint: "https://push.example/subscription",
    p256dh: "p256dh",
    auth: "auth",
  },
  payload: {
    notificationId: 7,
    title: "Giảm giá",
    body: "Laptop vừa giảm giá",
    url: "/products/7",
    tag: "price-alert-7",
    renotify: false,
    validUntil: new Date("2026-10-23T01:00:00.000Z"),
  },
};

describe("WebPushProvider", () => {
  it("sends an encrypted payload with VAPID and returns no invented message id", async () => {
    (webpush.sendNotification as jest.Mock).mockResolvedValue({ statusCode: 201 });
    const provider = createWebPushProvider({
      subject: "mailto:ops@example.test",
      publicKey: "public",
      privateKey: "private",
    });

    await expect(provider.send(input)).resolves.toEqual({ providerMessageId: null });
    expect(webpush.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: input.pushSubscription.endpoint }),
      expect.any(String),
      expect.objectContaining({
        TTL: expect.any(Number),
        topic: "price-alert-7",
      }),
    );
  });

  it.each([404, 410])("maps %s to a permanent subscription error", async (statusCode) => {
    (webpush.sendNotification as jest.Mock).mockRejectedValue({ statusCode });
    const provider = createWebPushProvider({
      subject: "mailto:ops@example.test",
      publicKey: "public",
      privateKey: "private",
    });

    await expect(provider.send(input)).rejects.toMatchObject({
      code: "PUSH_SUBSCRIPTION_GONE",
      retryable: false,
    });
  });

  it("maps 429 and 5xx to retryable errors", async () => {
    (webpush.sendNotification as jest.Mock).mockRejectedValue({ statusCode: 429 });
    const provider = createWebPushProvider({
      subject: "mailto:ops@example.test",
      publicKey: "public",
      privateKey: "private",
    });

    await expect(provider.send(input)).rejects.toMatchObject({ retryable: true });
  });
});
