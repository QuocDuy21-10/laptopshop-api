import type { NewsletterSubscriber } from "@prisma/client";

// token hashes and send timestamps stay internal
export const toSubscriberDto = (row: NewsletterSubscriber) => ({
  id: row.id,
  email: row.email,
  status: row.status,
  confirmedAt: row.confirmedAt,
  unsubscribedAt: row.unsubscribedAt,
  createdAt: row.createdAt,
});

export type SubscriberDto = ReturnType<typeof toSubscriberDto>;
