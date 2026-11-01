import type { NewsletterSubscriber, Prisma } from "@prisma/client";

import { assertExportSize, toCsv, type CsvColumn } from "lib/csv";
import { pageArgs, pageMeta } from "lib/http";
import { env } from "config/env";
import { AppError, isUniqueViolation } from "lib/errors";
import { logger } from "lib/logger";
import { prisma } from "config/client";
import { toSubscriberDto } from "modules/newsletter/newsletter.mapper";
import type {
  AdminExportSubscribersQuery,
  AdminListSubscribersQuery,
} from "modules/newsletter/newsletter.schema";
import {
  createConfirmToken,
  createUnsubscribeToken,
  hashConfirmToken,
  parseUnsubscribeToken,
} from "modules/newsletter/newsletter.tokens";
import { renderNewsletterConfirmationEmail } from "modules/notifications/notification-template";
import {
  isEmailDeliveryAvailable,
  sendEmail,
} from "modules/email-verification/email-verification.service";

const CONFIRM_TTL_MS = 24 * 60 * 60 * 1000;
const RESEND_AFTER_MS = 60_000;

const unavailable = () =>
  new AppError("Email delivery is unavailable", 503, "EMAIL_DELIVERY_UNAVAILABLE");
const invalidToken = () =>
  new AppError("Newsletter link is invalid or expired", 400, "NEWSLETTER_TOKEN_INVALID");

const storefrontUrl = (path: string, token: string) =>
  new URL(`${path}?token=${encodeURIComponent(token)}`, env.STOREFRONT_ORIGIN).toString();

// Always answers "accepted" (except when mail cannot be sent) so the endpoint cannot be used to find subscribed addresses.
export const subscribe = async (email: string): Promise<{ accepted: true }> => {
  if (!isEmailDeliveryAvailable()) throw unavailable();
  const now = new Date();
  const existing = await prisma.newsletterSubscriber.findUnique({ where: { email } });
  if (existing?.status === "CONFIRMED") return { accepted: true };
  if (
    existing?.lastConfirmationSentAt &&
    now.getTime() - existing.lastConfirmationSentAt.getTime() < RESEND_AFTER_MS
  )
    return { accepted: true };

  const { token, hash } = createConfirmToken();
  const data = {
    status: "PENDING" as const,
    confirmTokenHash: hash,
    confirmExpiresAt: new Date(now.getTime() + CONFIRM_TTL_MS),
  };
  let id: number;
  if (existing) {
    // guarded update: a subscriber confirmed in the meantime must not drop back to PENDING
    const { count } = await prisma.newsletterSubscriber.updateMany({
      where: { id: existing.id, status: { not: "CONFIRMED" } },
      data,
    });
    if (count === 0) return { accepted: true };
    id = existing.id;
  } else {
    try {
      id = (await prisma.newsletterSubscriber.create({ data: { email, ...data } })).id;
    } catch (error) {
      if (isUniqueViolation(error)) return { accepted: true };
      throw error;
    }
  }

  const sentAt = new Date();
  try {
    await sendEmail({
      to: email,
      ...renderNewsletterConfirmationEmail({
        confirmUrl: storefrontUrl("/newsletter/confirm", token),
        unsubscribeUrl: storefrontUrl("/newsletter/unsubscribe", createUnsubscribeToken(id)),
      }),
      idempotencyKey: `newsletter-confirm-${id}-${sentAt.getTime()}`,
    });
  } catch (error) {
    logger.warn({ err: error, subscriberId: id }, "newsletter confirmation email failed");
    throw unavailable();
  }
  await prisma.newsletterSubscriber.update({
    where: { id },
    data: { lastConfirmationSentAt: sentAt },
  });
  return { accepted: true };
};

export const confirmSubscription = async (token: string): Promise<{ status: "CONFIRMED" }> => {
  const now = new Date();
  const hash = hashConfirmToken(token);
  const row = await prisma.newsletterSubscriber.findFirst({
    where: { confirmTokenHash: hash, status: "PENDING", confirmExpiresAt: { gt: now } },
  });
  if (!row) throw invalidToken();
  const { count } = await prisma.newsletterSubscriber.updateMany({
    where: { id: row.id, confirmTokenHash: hash, status: "PENDING" },
    data: {
      status: "CONFIRMED",
      confirmedAt: now,
      confirmTokenHash: null,
      confirmExpiresAt: null,
    },
  });
  if (count === 0) throw invalidToken();
  return { status: "CONFIRMED" };
};

export const unsubscribe = async (token: string): Promise<{ status: "UNSUBSCRIBED" }> => {
  const id = parseUnsubscribeToken(token);
  if (id === null) throw invalidToken();
  const row = await prisma.newsletterSubscriber.findUnique({ where: { id } });
  if (!row) throw invalidToken();
  if (row.status !== "UNSUBSCRIBED") {
    await prisma.newsletterSubscriber.update({
      where: { id },
      data: {
        status: "UNSUBSCRIBED",
        unsubscribedAt: new Date(),
        confirmTokenHash: null,
        confirmExpiresAt: null,
      },
    });
  }
  return { status: "UNSUBSCRIBED" };
};

const subscriberWhere = (query: {
  status?: NewsletterSubscriber["status"];
  q?: string;
}): Prisma.NewsletterSubscriberWhereInput => ({
  ...(query.status ? { status: query.status } : {}),
  ...(query.q ? { email: { contains: query.q } } : {}),
});

export const listSubscribers = async (query: AdminListSubscribersQuery) => {
  const where = subscriberWhere(query);
  const [total, rows] = await Promise.all([
    prisma.newsletterSubscriber.count({ where }),
    prisma.newsletterSubscriber.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...pageArgs(query),
    }),
  ]);
  return { items: rows.map(toSubscriberDto), meta: pageMeta(query, total) };
};

const iso = (date: Date | null) => (date ? date.toISOString() : null);

const SUBSCRIBER_COLUMNS: CsvColumn<NewsletterSubscriber>[] = [
  { header: "Email", value: (s) => s.email },
  { header: "Trạng thái", value: (s) => s.status },
  { header: "Ngày đăng ký", value: (s) => iso(s.createdAt) },
  { header: "Ngày xác nhận", value: (s) => iso(s.confirmedAt) },
  { header: "Ngày hủy", value: (s) => iso(s.unsubscribedAt) },
];

export const exportSubscribers = async (query: AdminExportSubscribersQuery) => {
  const where = subscriberWhere(query);
  assertExportSize(await prisma.newsletterSubscriber.count({ where }));
  return toCsv(
    SUBSCRIBER_COLUMNS,
    await prisma.newsletterSubscriber.findMany({ where, orderBy: { id: "asc" } }),
  );
};
