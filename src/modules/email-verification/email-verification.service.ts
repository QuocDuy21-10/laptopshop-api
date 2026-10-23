import { env } from "config/env";
import { AppError } from "lib/errors";
import { createEmailOtp, verifyEmailOtp } from "modules/email-verification/email-otp.crypto";
import { createOutboxEvent } from "modules/outbox/outbox.repository";
import type { EmailProvider } from "modules/notifications/providers/email.provider";
import { prisma } from "config/client";
import { createSmtpEmailProvider } from "modules/notifications/providers/smtp-email.provider";

let emailProvider: EmailProvider | null =
  env.EMAIL_ENABLED && env.EMAIL_PROVIDER === "smtp"
    ? createSmtpEmailProvider({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        user: env.SMTP_USER,
        password: env.SMTP_PASSWORD,
        from: env.EMAIL_FROM,
      })
    : null;

export const setEmailProvider = (provider: EmailProvider | null) => {
  emailProvider = provider;
};

const unavailable = () =>
  new AppError("Email delivery is unavailable", 503, "EMAIL_DELIVERY_UNAVAILABLE");

export const requestEmailVerification = async (userId: number) => {
  if (!env.EMAIL_ENABLED || !emailProvider) throw unavailable();
  const now = new Date();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true, emailVerifiedAt: true },
  });
  if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");
  if (user.emailVerifiedAt)
    throw new AppError("Email is already verified", 409, "EMAIL_ALREADY_VERIFIED");

  const active = await prisma.emailVerificationChallenge.findFirst({
    where: {
      userId,
      consumedAt: null,
      invalidatedAt: null,
      lastSentAt: { gt: new Date(now.getTime() - 60_000) },
    },
  });
  if (active)
    throw new AppError("Please wait before requesting another code", 429, "EMAIL_OTP_RATE_LIMITED");

  const encrypted = createEmailOtp(env.EMAIL_OTP_ENCRYPTION_KEY!, env.EMAIL_OTP_KEY_VERSION);
  return prisma.$transaction(async (tx) => {
    const previous = await tx.emailVerificationChallenge.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { failedAttempts: true },
    });
    await tx.emailVerificationChallenge.updateMany({
      where: { userId, consumedAt: null, invalidatedAt: null },
      data: { invalidatedAt: now },
    });
    const challenge = await tx.emailVerificationChallenge.create({
      data: {
        userId,
        email: user.username,
        otpHash: encrypted.otpHash,
        otpCiphertext: encrypted.otpCiphertext,
        otpIv: encrypted.otpIv,
        otpTag: encrypted.otpTag,
        encryptionKeyVersion: encrypted.encryptionKeyVersion,
        expiresAt: new Date(now.getTime() + 600_000),
        lastSentAt: now,
        sendCount: 1,
        failedAttempts: previous?.failedAttempts ?? 0,
      },
    });
    const delivery = await tx.notificationDelivery.create({
      data: {
        emailVerificationChallengeId: challenge.id,
        parentType: "EMAIL_VERIFICATION",
        channel: "EMAIL",
        dedupeKey: "email-otp-" + challenge.id,
        destinationKey: user.username,
      },
    });
    await createOutboxEvent(tx, {
      eventType: "NOTIFICATION_DELIVERY_REQUESTED",
      aggregateType: "EmailVerificationChallenge",
      aggregateId: challenge.id,
      dedupeKey: "email-otp-outbox-" + delivery.id,
      payload: { deliveryId: delivery.id, challengeId: challenge.id },
    });
    return { accepted: true };
  });
};

export const confirmEmailVerification = async (userId: number, code: string) => {
  const now = new Date();
  const challenge = await prisma.emailVerificationChallenge.findFirst({
    where: { userId, consumedAt: null, invalidatedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge || challenge.expiresAt <= now) {
    throw new AppError("Email OTP is expired", 400, "EMAIL_OTP_EXPIRED");
  }
  if (challenge.failedAttempts >= 5) {
    throw new AppError("Email OTP is locked", 429, "EMAIL_OTP_LOCKED");
  }
  if (!verifyEmailOtp(challenge.otpHash, code)) {
    const nextAttempts = challenge.failedAttempts + 1;
    await prisma.emailVerificationChallenge.updateMany({
      where: {
        id: challenge.id,
        consumedAt: null,
        invalidatedAt: null,
        failedAttempts: challenge.failedAttempts,
      },
      data: {
        failedAttempts: { increment: 1 },
        ...(nextAttempts >= 5 ? { invalidatedAt: now } : {}),
      },
    });
    throw new AppError("Email OTP is invalid", 400, "EMAIL_OTP_INVALID");
  }
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { username: true } });
    if (!user || user.username !== challenge.email) {
      throw new AppError("Email has changed", 409, "EMAIL_OTP_INVALID");
    }
    const claimed = await tx.emailVerificationChallenge.updateMany({
      where: {
        id: challenge.id,
        consumedAt: null,
        invalidatedAt: null,
        failedAttempts: challenge.failedAttempts,
      },
      data: { consumedAt: now, otpCiphertext: "", otpIv: "", otpTag: "" },
    });
    if (claimed.count !== 1) throw new AppError("Email OTP is invalid", 409, "EMAIL_OTP_INVALID");
    await tx.user.update({ where: { id: userId }, data: { emailVerifiedAt: now } });
    return { verified: true };
  });
};
