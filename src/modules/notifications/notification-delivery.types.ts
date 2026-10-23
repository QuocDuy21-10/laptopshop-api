export type DeliveryProviderResult = { providerMessageId: string | null };

export type DeliveryChannelProvider<Input = unknown> = {
  send: (input: Input) => Promise<DeliveryProviderResult>;
};

export type DeliveryProviderRegistry = {
  EMAIL?: DeliveryChannelProvider;
  WEB_PUSH?: DeliveryChannelProvider;
};

export type DeliveryProcessResult =
  "noop" | "missing" | "suppressed" | "delivered" | "retrying" | "failed" | "dead";

export type DeliveryRecord = {
  id: number;
  channel: "EMAIL" | "WEB_PUSH";
  status:
    | "PENDING"
    | "PROCESSING"
    | "DELIVERED"
    | "RETRYING"
    | "FAILED"
    | "DEAD"
    | "CANCELLED"
    | "SUPPRESSED";
  attemptCount: number;
  destinationKey: string;
  destinationSnapshot: string | null;
  notificationId: number | null;
  emailVerificationChallengeId: number | null;
  pushSubscriptionId?: number | null;
  notification?: {
    id: number;
    title: string;
    message: string;
    type: string;
    serviceRequestId: number | null;
    productId: number | null;
    oldPrice: number | null;
    newPrice: number | null;
    priceSource: string | null;
    validUntil: Date | null;
    user?: {
      username: string;
      emailVerifiedAt: Date | null;
      notificationPreference?: {
        emailEnabled: boolean;
        webPushEnabled: boolean;
        afterSalesEmailEnabled: boolean;
        afterSalesWebPushEnabled: boolean;
      } | null;
    } | null;
  } | null;
  preference?: { emailEnabled: boolean; webPushEnabled: boolean } | null;
  user?: { username: string; emailVerifiedAt: Date | null } | null;
  pushSubscription?: {
    disabledAt: Date | null;
    endpoint?: string;
    p256dh?: string;
    auth?: string;
  } | null;
  emailVerificationChallenge?: {
    email: string;
    otpCiphertext?: string;
    otpIv?: string;
    otpTag?: string;
    encryptionKeyVersion?: string;
    consumedAt: Date | null;
    invalidatedAt: Date | null;
  } | null;
};
