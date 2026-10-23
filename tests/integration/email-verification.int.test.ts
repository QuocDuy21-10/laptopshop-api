import { prisma } from "config/client";
import { env } from "config/env";
import { createEmailOtp } from "modules/email-verification/email-otp.crypto";
import {
  confirmEmailVerification,
  requestEmailVerification,
} from "modules/email-verification/email-verification.service";
import { createUser, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("email verification persistence", () => {
  it("consumes one OTP and marks the current email verified", async () => {
    const user = await createUser();
    const otp = createEmailOtp("a".repeat(64), "v1");
    await prisma.emailVerificationChallenge.create({
      data: {
        userId: user.id,
        email: user.username,
        otpHash: otp.otpHash,
        otpCiphertext: otp.otpCiphertext,
        otpIv: otp.otpIv,
        otpTag: otp.otpTag,
        encryptionKeyVersion: otp.encryptionKeyVersion,
        expiresAt: new Date(Date.now() + 600_000),
      },
    });

    await expect(confirmEmailVerification(user.id, otp.code)).resolves.toEqual({ verified: true });
    await expect(prisma.user.findUnique({ where: { id: user.id } })).resolves.toMatchObject({
      emailVerifiedAt: expect.any(Date),
    });
  });

  it("does not create a challenge while Email delivery is disabled", async () => {
    const user = await createUser();
    await expect(requestEmailVerification(user.id)).rejects.toMatchObject({
      code: "EMAIL_DELIVERY_UNAVAILABLE",
    });
    expect(env.EMAIL_ENABLED).toBe(false);
  });
});
