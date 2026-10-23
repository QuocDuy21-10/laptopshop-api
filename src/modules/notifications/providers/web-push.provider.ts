import * as webpush from "web-push";

type WebPushProviderInput = {
  destinationKey: string;
  pushSubscription: { endpoint: string; p256dh: string; auth: string };
  payload: {
    notificationId: number;
    title: string;
    body: string;
    url: string;
    tag: string;
    renotify: boolean;
    validUntil: Date | null;
  };
};

const providerError = (code: string, retryable: boolean) =>
  Object.assign(new Error(code), { code, retryable });

export const createWebPushProvider = (input: {
  subject: string;
  publicKey: string;
  privateKey: string;
}) => {
  webpush.setVapidDetails(input.subject, input.publicKey, input.privateKey);
  return {
    send: async (delivery: WebPushProviderInput) => {
      try {
        const ttl = delivery.payload.validUntil
          ? Math.max(0, Math.floor((delivery.payload.validUntil.getTime() - Date.now()) / 1000))
          : 300;
        await webpush.sendNotification(
          {
            endpoint: delivery.pushSubscription.endpoint,
            keys: {
              p256dh: delivery.pushSubscription.p256dh,
              auth: delivery.pushSubscription.auth,
            },
          },
          JSON.stringify({
            notificationId: delivery.payload.notificationId,
            title: delivery.payload.title,
            body: delivery.payload.body,
            url: delivery.payload.url,
            tag: delivery.payload.tag,
            renotify: false,
          }),
          { TTL: Math.min(ttl, 86_400), topic: delivery.payload.tag.slice(0, 32) },
        );
        return { providerMessageId: null };
      } catch (error) {
        const statusCode =
          error && typeof error === "object" && "statusCode" in error
            ? Number(error.statusCode)
            : null;
        if (statusCode === 404 || statusCode === 410) {
          throw providerError("PUSH_SUBSCRIPTION_GONE", false);
        }
        throw providerError(
          "PUSH_PROVIDER_ERROR",
          statusCode === 429 || (statusCode !== null && statusCode >= 500),
        );
      }
    },
  };
};

export type { WebPushProviderInput };
