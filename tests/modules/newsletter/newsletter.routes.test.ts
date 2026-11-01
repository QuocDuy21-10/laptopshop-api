jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import { env } from "config/env";
import { setEmailProvider } from "modules/email-verification/email-verification.service";
import {
  createConfirmToken,
  createUnsubscribeToken,
  hashConfirmToken,
} from "modules/newsletter/newsletter.tokens";
import { prismaError, prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";

const send = jest.fn();
const original = { enabled: env.EMAIL_ENABLED, origin: env.STOREFRONT_ORIGIN };

beforeAll(() => {
  Object.assign(env, { EMAIL_ENABLED: true, STOREFRONT_ORIGIN: "https://shop.test" });
});
afterAll(() => {
  Object.assign(env, { EMAIL_ENABLED: original.enabled, STOREFRONT_ORIGIN: original.origin });
  setEmailProvider(null);
});
beforeEach(() => {
  resetPrisma();
  send.mockReset().mockResolvedValue({ providerMessageId: "m1" });
  setEmailProvider({ send });
});

const row = (over: Record<string, unknown> = {}) => ({
  id: 7,
  email: "a@b.co",
  status: "PENDING",
  confirmTokenHash: null,
  confirmExpiresAt: null,
  lastConfirmationSentAt: null,
  confirmedAt: null,
  unsubscribedAt: null,
  createdAt: new Date("2026-10-01T00:00:00.000Z"),
  updatedAt: new Date("2026-10-01T00:00:00.000Z"),
  ...over,
});

const subscribe = (email: unknown = "A@B.co ") =>
  request(buildApp()).post("/api/v1/newsletter/subscribe").send({ email });

describe("POST /api/v1/newsletter/subscribe", () => {
  it("creates a pending subscriber and emails a confirmation link", async () => {
    prismaMock.newsletterSubscriber.findUnique.mockResolvedValue(null);
    prismaMock.newsletterSubscriber.create.mockImplementation(async ({ data }: any) =>
      row({ ...data, id: 7 }),
    );
    prismaMock.newsletterSubscriber.update.mockResolvedValue(row());

    const res = await subscribe();

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ data: { accepted: true } });
    const data = prismaMock.newsletterSubscriber.create.mock.calls[0][0].data;
    expect(data.email).toBe("a@b.co");
    expect(data.status).toBe("PENDING");
    expect(data.confirmTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(data.confirmExpiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    expect(send).toHaveBeenCalledTimes(1);
    const mail = send.mock.calls[0][0];
    expect(mail.to).toBe("a@b.co");
    const link = /https:\/\/shop\.test\/newsletter\/confirm\?token=[^\s"&]+/.exec(mail.text)![0];
    const token = new URL(link).searchParams.get("token")!;
    expect(hashConfirmToken(token)).toBe(data.confirmTokenHash);
    expect(JSON.stringify(prismaMock.newsletterSubscriber.create.mock.calls)).not.toContain(token);
    expect(mail.text).toContain(
      `https://shop.test/newsletter/unsubscribe?token=${createUnsubscribeToken(7)}`,
    );
    expect(prismaMock.newsletterSubscriber.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { lastConfirmationSentAt: expect.any(Date) },
    });
  });

  it("answers 202 without emailing when the subscriber is already confirmed", async () => {
    prismaMock.newsletterSubscriber.findUnique.mockResolvedValue(row({ status: "CONFIRMED" }));
    const res = await subscribe();
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ data: { accepted: true } });
    expect(send).not.toHaveBeenCalled();
    expect(prismaMock.newsletterSubscriber.updateMany).not.toHaveBeenCalled();
  });

  it("answers 202 without emailing again within 60 seconds", async () => {
    prismaMock.newsletterSubscriber.findUnique.mockResolvedValue(
      row({ lastConfirmationSentAt: new Date(Date.now() - 10_000) }),
    );
    const res = await subscribe();
    expect(res.status).toBe(202);
    expect(send).not.toHaveBeenCalled();
  });

  it("re-subscribes an unsubscribed email as pending and emails again", async () => {
    prismaMock.newsletterSubscriber.findUnique.mockResolvedValue(
      row({ status: "UNSUBSCRIBED", lastConfirmationSentAt: new Date(Date.now() - 120_000) }),
    );
    prismaMock.newsletterSubscriber.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.newsletterSubscriber.update.mockResolvedValue(row());
    const res = await subscribe();
    expect(res.status).toBe(202);
    expect(prismaMock.newsletterSubscriber.updateMany).toHaveBeenCalledWith({
      where: { id: 7, status: { not: "CONFIRMED" } },
      data: expect.objectContaining({ status: "PENDING", confirmTokenHash: expect.any(String) }),
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not email when the row was confirmed concurrently", async () => {
    prismaMock.newsletterSubscriber.findUnique.mockResolvedValue(row());
    prismaMock.newsletterSubscriber.updateMany.mockResolvedValue({ count: 0 });
    const res = await subscribe();
    expect(res.status).toBe(202);
    expect(send).not.toHaveBeenCalled();
  });

  it("treats a concurrent duplicate insert as accepted", async () => {
    prismaMock.newsletterSubscriber.findUnique.mockResolvedValue(null);
    prismaMock.newsletterSubscriber.create.mockRejectedValue(prismaError("P2002"));
    const res = await subscribe();
    expect(res.status).toBe(202);
    expect(send).not.toHaveBeenCalled();
  });

  it("returns 503 and keeps the retry window open when sending fails", async () => {
    prismaMock.newsletterSubscriber.findUnique.mockResolvedValue(null);
    prismaMock.newsletterSubscriber.create.mockImplementation(async ({ data }: any) => row(data));
    send.mockRejectedValue(new Error("smtp down"));
    const res = await subscribe();
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("EMAIL_DELIVERY_UNAVAILABLE");
    expect(prismaMock.newsletterSubscriber.update).not.toHaveBeenCalled();
  });

  it("returns 503 and writes nothing when email delivery is off", async () => {
    Object.assign(env, { EMAIL_ENABLED: false });
    try {
      const res = await subscribe();
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("EMAIL_DELIVERY_UNAVAILABLE");
      expect(prismaMock.newsletterSubscriber.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.newsletterSubscriber.create).not.toHaveBeenCalled();
    } finally {
      Object.assign(env, { EMAIL_ENABLED: true });
    }
  });

  it("rejects a malformed email with 400", async () => {
    const res = await subscribe("nope");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /api/v1/newsletter/confirm", () => {
  const post = (token: unknown) =>
    request(buildApp()).post("/api/v1/newsletter/confirm").send({ token });

  it("confirms a pending subscriber with a valid token", async () => {
    const { token, hash } = createConfirmToken();
    prismaMock.newsletterSubscriber.findFirst.mockResolvedValue(
      row({ confirmTokenHash: hash, confirmExpiresAt: new Date(Date.now() + 60_000) }),
    );
    prismaMock.newsletterSubscriber.updateMany.mockResolvedValue({ count: 1 });

    const res = await post(token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { status: "CONFIRMED" } });
    expect(prismaMock.newsletterSubscriber.findFirst).toHaveBeenCalledWith({
      where: {
        confirmTokenHash: hash,
        status: "PENDING",
        confirmExpiresAt: { gt: expect.any(Date) },
      },
    });
    expect(prismaMock.newsletterSubscriber.updateMany).toHaveBeenCalledWith({
      where: { id: 7, confirmTokenHash: hash, status: "PENDING" },
      data: {
        status: "CONFIRMED",
        confirmedAt: expect.any(Date),
        confirmTokenHash: null,
        confirmExpiresAt: null,
      },
    });
  });

  it("rejects an unknown, expired or used token with one generic error", async () => {
    prismaMock.newsletterSubscriber.findFirst.mockResolvedValue(null);
    const res = await post("whatever");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("NEWSLETTER_TOKEN_INVALID");
  });

  it("rejects when the row changed between the read and the update", async () => {
    const { token, hash } = createConfirmToken();
    prismaMock.newsletterSubscriber.findFirst.mockResolvedValue(row({ confirmTokenHash: hash }));
    prismaMock.newsletterSubscriber.updateMany.mockResolvedValue({ count: 0 });
    const res = await post(token);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("NEWSLETTER_TOKEN_INVALID");
  });

  it("rejects a missing token with 400", async () => {
    const res = await request(buildApp()).post("/api/v1/newsletter/confirm").send({});
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/newsletter/unsubscribe", () => {
  const post = (token: unknown) =>
    request(buildApp()).post("/api/v1/newsletter/unsubscribe").send({ token });

  it("unsubscribes with a valid token", async () => {
    prismaMock.newsletterSubscriber.findUnique.mockResolvedValue(row({ status: "CONFIRMED" }));
    prismaMock.newsletterSubscriber.update.mockResolvedValue(row({ status: "UNSUBSCRIBED" }));
    const res = await post(createUnsubscribeToken(7));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { status: "UNSUBSCRIBED" } });
    expect(prismaMock.newsletterSubscriber.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        status: "UNSUBSCRIBED",
        unsubscribedAt: expect.any(Date),
        confirmTokenHash: null,
        confirmExpiresAt: null,
      },
    });
  });

  it("is idempotent for an already unsubscribed subscriber", async () => {
    prismaMock.newsletterSubscriber.findUnique.mockResolvedValue(row({ status: "UNSUBSCRIBED" }));
    const res = await post(createUnsubscribeToken(7));
    expect(res.status).toBe(200);
    expect(prismaMock.newsletterSubscriber.update).not.toHaveBeenCalled();
  });

  it("rejects a forged token, a malformed token and an unknown id", async () => {
    const forged = await post(`7.${"A".repeat(43)}`);
    expect(forged.status).toBe(400);
    expect(forged.body.error.code).toBe("NEWSLETTER_TOKEN_INVALID");
    expect((await post("garbage")).status).toBe(400);
    prismaMock.newsletterSubscriber.findUnique.mockResolvedValue(null);
    const unknown = await post(createUnsubscribeToken(99));
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe("NEWSLETTER_TOKEN_INVALID");
  });
});
