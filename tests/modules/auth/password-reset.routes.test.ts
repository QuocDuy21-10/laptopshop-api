jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import { createHash } from "crypto";
import bcrypt from "bcrypt";
import request from "supertest";
import { env } from "config/env";
import { setEmailProvider } from "modules/email-verification/email-verification.service";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";

const KEY = "0".repeat(64);
const user = { id: 5, username: "a@b.co", accountType: "SYSTEM" };
const challenge = (over: Record<string, unknown> = {}) => ({
  id: 11,
  userId: 5,
  purpose: "PASSWORD_RESET",
  otpHash: createHash("sha256").update("123456").digest("hex"),
  expiresAt: new Date(Date.now() + 600_000),
  failedAttempts: 0,
  ...over,
});
const resetBody = {
  username: "a@b.co",
  code: "123456",
  password: "newpassword1",
  confirmPassword: "newpassword1",
};

const original = { enabled: env.EMAIL_ENABLED, key: env.EMAIL_OTP_ENCRYPTION_KEY };
beforeAll(() => {
  Object.assign(env, { EMAIL_ENABLED: true, EMAIL_OTP_ENCRYPTION_KEY: KEY });
  setEmailProvider({ send: jest.fn() } as never);
});
afterAll(() => {
  Object.assign(env, { EMAIL_ENABLED: original.enabled, EMAIL_OTP_ENCRYPTION_KEY: original.key });
  setEmailProvider(null);
});
beforeEach(resetPrisma);

describe("POST /api/v1/auth/forgot-password", () => {
  it("answers 503 when email delivery is off", async () => {
    setEmailProvider(null);
    const res = await request(buildApp())
      .post("/api/v1/auth/forgot-password")
      .send({ username: "a@b.co" });
    setEmailProvider({ send: jest.fn() } as never);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("EMAIL_DELIVERY_UNAVAILABLE");
  });

  it("accepts an unknown email without creating anything (no account enumeration)", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await request(buildApp())
      .post("/api/v1/auth/forgot-password")
      .send({ username: "x@y.co" });
    expect(res.status).toBe(202);
    expect(res.body.data).toEqual({ accepted: true });
    expect(prismaMock.emailVerificationChallenge.create).not.toHaveBeenCalled();
  });

  it("does not issue codes for social accounts", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...user, accountType: "GOOGLE" });
    const res = await request(buildApp())
      .post("/api/v1/auth/forgot-password")
      .send({ username: "a@b.co" });
    expect(res.status).toBe(202);
    expect(prismaMock.emailVerificationChallenge.create).not.toHaveBeenCalled();
  });

  it("creates a PASSWORD_RESET challenge with a delivery and an outbox event", async () => {
    prismaMock.user.findUnique.mockResolvedValue(user);
    prismaMock.emailVerificationChallenge.findFirst.mockResolvedValue(null);
    prismaMock.emailVerificationChallenge.create.mockResolvedValue({ id: 11 });
    prismaMock.notificationDelivery.create.mockResolvedValue({ id: 21 });
    const res = await request(buildApp())
      .post("/api/v1/auth/forgot-password")
      .send({ username: "a@b.co" });
    expect(res.status).toBe(202);
    const data = prismaMock.emailVerificationChallenge.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ userId: 5, purpose: "PASSWORD_RESET", email: "a@b.co" });
    expect(prismaMock.notificationDelivery.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.outboxEvent.create).toHaveBeenCalledTimes(1);
  });

  it("stays silent when a code was sent in the last minute", async () => {
    prismaMock.user.findUnique.mockResolvedValue(user);
    prismaMock.emailVerificationChallenge.findFirst.mockResolvedValue({ id: 1 });
    const res = await request(buildApp())
      .post("/api/v1/auth/forgot-password")
      .send({ username: "a@b.co" });
    expect(res.status).toBe(202);
    expect(prismaMock.emailVerificationChallenge.create).not.toHaveBeenCalled();
  });

  it("rejects a malformed email", async () => {
    const res = await request(buildApp())
      .post("/api/v1/auth/forgot-password")
      .send({ username: "nope" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/auth/reset-password", () => {
  const post = (body: object = resetBody) =>
    request(buildApp()).post("/api/v1/auth/reset-password").send(body);

  it("rejects a code that is not 6 digits and mismatched passwords", async () => {
    expect((await post({ ...resetBody, code: "12ab" })).status).toBe(400);
    expect((await post({ ...resetBody, confirmPassword: "different1" })).status).toBe(400);
  });

  it("answers the same generic error for an unknown email", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await post();
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PASSWORD_RESET_CODE_INVALID");
  });

  it("counts a wrong code and keeps the password", async () => {
    prismaMock.user.findUnique.mockResolvedValue(user);
    prismaMock.emailVerificationChallenge.findFirst.mockResolvedValue(challenge());
    const res = await post({ ...resetBody, code: "000000" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PASSWORD_RESET_CODE_INVALID");
    expect(
      prismaMock.emailVerificationChallenge.updateMany.mock.calls[0][0].data.failedAttempts,
    ).toEqual({ increment: 1 });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("invalidates the challenge on the fifth wrong code", async () => {
    prismaMock.user.findUnique.mockResolvedValue(user);
    prismaMock.emailVerificationChallenge.findFirst.mockResolvedValue(
      challenge({ failedAttempts: 4 }),
    );
    await post({ ...resetBody, code: "000000" });
    expect(
      prismaMock.emailVerificationChallenge.updateMany.mock.calls[0][0].data.invalidatedAt,
    ).toBeInstanceOf(Date);
  });

  it("locks after too many attempts and rejects expired codes", async () => {
    prismaMock.user.findUnique.mockResolvedValue(user);
    prismaMock.emailVerificationChallenge.findFirst.mockResolvedValue(
      challenge({ failedAttempts: 5 }),
    );
    expect((await post()).status).toBe(429);
    prismaMock.emailVerificationChallenge.findFirst.mockResolvedValue(
      challenge({ expiresAt: new Date(Date.now() - 1000) }),
    );
    expect((await post()).status).toBe(400);
  });

  it("sets the new hash, consumes the code, revokes every session and clears cookies", async () => {
    prismaMock.user.findUnique.mockResolvedValue(user);
    prismaMock.emailVerificationChallenge.findFirst.mockResolvedValue(challenge());
    prismaMock.emailVerificationChallenge.updateMany.mockResolvedValue({ count: 1 });
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ reset: true });
    const update = prismaMock.user.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: 5 });
    expect(await bcrypt.compare("newpassword1", update.data.password)).toBe(true);
    expect(prismaMock.refreshToken.updateMany.mock.calls[0][0].where).toEqual({
      userId: 5,
      revokedAt: null,
    });
    const cookies = (res.headers["set-cookie"] as unknown as string[]).join(";");
    expect(cookies).toMatch(/access_token=;/);
    expect(cookies).toMatch(/logged_in=;/);
  });

  it("fails when another request consumed the code first", async () => {
    prismaMock.user.findUnique.mockResolvedValue(user);
    prismaMock.emailVerificationChallenge.findFirst.mockResolvedValue(challenge());
    prismaMock.emailVerificationChallenge.updateMany.mockResolvedValue({ count: 0 });
    expect((await post()).status).toBe(400);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});
