import { prisma } from "config/client";
import { ACCOUNT_TYPE } from "config/constant";
import { AppError } from "lib/errors";
import { hashPassword } from "lib/password";
import { createEmailOtp, verifyEmailOtp } from "modules/email-verification/email-otp.crypto";
import { isEmailDeliveryAvailable } from "modules/email-verification/email-verification.service";
import { createOutboxEvent } from "modules/outbox/outbox.repository";
import { env } from "config/env";
import { PASSWORD_RESET_TTL_MINUTES } from "modules/auth/password-reset.constants";

const RESEND_AFTER_MS = 60_000;
const MAX_FAILED_ATTEMPTS = 5;

const invalidCode = () =>
  new AppError("Invalid or expired reset code", 400, "PASSWORD_RESET_CODE_INVALID");

const findResettableUser = async (username: string) => {
  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true, username: true, accountType: true },
  });
  // social accounts have no password to reset
  return user && user.accountType === ACCOUNT_TYPE.SYSTEM ? user : null;
};

// Always answers "accepted" for a well-formed email so the endpoint cannot be used to find registered addresses.
export const requestPasswordReset = async (username: string) => {
  if (!isEmailDeliveryAvailable()) {
    throw new AppError("Email delivery is unavailable", 503, "EMAIL_DELIVERY_UNAVAILABLE");
  }
  const user = await findResettableUser(username);
  if (!user) return { accepted: true };

  const now = new Date();
  const recent = await prisma.emailVerificationChallenge.findFirst({
    where: {
      userId: user.id,
      purpose: "PASSWORD_RESET",
      consumedAt: null,
      invalidatedAt: null,
      lastSentAt: { gt: new Date(now.getTime() - RESEND_AFTER_MS) },
    },
    select: { id: true },
  });
  if (recent) return { accepted: true };

  const encrypted = createEmailOtp(env.EMAIL_OTP_ENCRYPTION_KEY!, env.EMAIL_OTP_KEY_VERSION);
  await prisma.$transaction(async (tx) => {
    await tx.emailVerificationChallenge.updateMany({
      where: { userId: user.id, purpose: "PASSWORD_RESET", consumedAt: null, invalidatedAt: null },
      data: { invalidatedAt: now },
    });
    const challenge = await tx.emailVerificationChallenge.create({
      data: {
        userId: user.id,
        purpose: "PASSWORD_RESET",
        email: user.username,
        otpHash: encrypted.otpHash,
        otpCiphertext: encrypted.otpCiphertext,
        otpIv: encrypted.otpIv,
        otpTag: encrypted.otpTag,
        encryptionKeyVersion: encrypted.encryptionKeyVersion,
        expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MINUTES * 60_000),
        lastSentAt: now,
        sendCount: 1,
      },
    });
    const delivery = await tx.notificationDelivery.create({
      data: {
        emailVerificationChallengeId: challenge.id,
        parentType: "EMAIL_VERIFICATION",
        channel: "EMAIL",
        dedupeKey: "password-reset-" + challenge.id,
        destinationKey: user.username,
      },
    });
    await createOutboxEvent(tx, {
      eventType: "NOTIFICATION_DELIVERY_REQUESTED",
      aggregateType: "EmailVerificationChallenge",
      aggregateId: challenge.id,
      dedupeKey: "password-reset-outbox-" + delivery.id,
      payload: { deliveryId: delivery.id, challengeId: challenge.id },
    });
  });
  return { accepted: true };
};

export const resetPassword = async (input: {
  username: string;
  code: string;
  password: string;
}) => {
  const now = new Date();
  const user = await findResettableUser(input.username);
  if (!user) throw invalidCode();
  const challenge = await prisma.emailVerificationChallenge.findFirst({
    where: { userId: user.id, purpose: "PASSWORD_RESET", consumedAt: null, invalidatedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge || challenge.expiresAt <= now) throw invalidCode();
  if (challenge.failedAttempts >= MAX_FAILED_ATTEMPTS) {
    throw new AppError("Too many attempts", 429, "PASSWORD_RESET_LOCKED");
  }
  if (!verifyEmailOtp(challenge.otpHash, input.code)) {
    const next = challenge.failedAttempts + 1;
    await prisma.emailVerificationChallenge.updateMany({
      where: {
        id: challenge.id,
        consumedAt: null,
        invalidatedAt: null,
        failedAttempts: challenge.failedAttempts,
      },
      data: {
        failedAttempts: { increment: 1 },
        ...(next >= MAX_FAILED_ATTEMPTS ? { invalidatedAt: now } : {}),
      },
    });
    throw invalidCode();
  }

  const password = await hashPassword(input.password);
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.emailVerificationChallenge.updateMany({
      where: {
        id: challenge.id,
        consumedAt: null,
        invalidatedAt: null,
        failedAttempts: challenge.failedAttempts,
      },
      data: { consumedAt: now, otpCiphertext: "", otpIv: "", otpTag: "" },
    });
    if (claimed.count !== 1) throw invalidCode();
    await tx.user.update({ where: { id: user.id }, data: { password } });
    // a reset must sign out every device that still holds the old password's session
    await tx.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: now },
    });
  });
  return { reset: true };
};
