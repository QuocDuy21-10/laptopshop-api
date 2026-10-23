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
  preference?: { emailEnabled: boolean; webPushEnabled: boolean } | null;
  user?: { username: string; emailVerifiedAt: Date | null } | null;
  pushSubscription?: { disabledAt: Date | null } | null;
  emailVerificationChallenge?: {
    email: string;
    consumedAt: Date | null;
    invalidatedAt: Date | null;
  } | null;
};
