jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import crypto from "node:crypto";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";
import { USER, cookieFor } from "../../helpers/auth";

const paymentRow = {
  id: "pay-1",
  orderId: 50,
  provider: "fake",
  method: "BANK_TRANSFER",
  status: "PENDING",
  amount: 1000,
  currency: "VND",
  transferCode: "LSABC12345678",
  bankCode: "VCB",
  accountNumber: "0123456789",
  accountName: "LAPTOP SHOP",
  expiresAt: new Date(Date.now() + 15 * 60_000),
  cancelAfter: new Date(Date.now() + 17 * 60_000),
  providerMode: "test",
  reviewAfter: new Date(Date.now() + 75 * 60_000),
  paidAt: null,
  cancelledAt: null,
  order: { id: 50, userId: USER.id, status: "PENDING", paymentStatus: "PAYMENT_UNPAID" },
};

beforeEach(resetPrisma);

describe("GET /api/v1/orders/me/:id/payment", () => {
  it("returns owned payment instructions while pending", async () => {
    prismaMock.payment.findFirst.mockResolvedValue(paymentRow);
    const res = await request(buildApp())
      .get("/api/v1/orders/me/50/payment")
      .set("Cookie", cookieFor(USER));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: "pay-1", status: "PENDING", amount: 1000 });
    expect(res.body.data.instructions).toMatchObject({ transferCode: "LSABC12345678" });
    expect(prismaMock.payment.findFirst.mock.calls[0][0].where).toEqual({
      order: { id: 50, userId: USER.id },
    });
  });

  it("returns 404 when the order has no payment", async () => {
    prismaMock.payment.findFirst.mockResolvedValue(null);
    const res = await request(buildApp())
      .get("/api/v1/orders/me/50/payment")
      .set("Cookie", cookieFor(USER));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PAYMENT_NOT_FOUND");
  });

  it("hides QR instructions after the payment deadline", async () => {
    prismaMock.payment.findFirst.mockResolvedValue({
      ...paymentRow,
      expiresAt: new Date(Date.now() - 1000),
    });
    const res = await request(buildApp())
      .get("/api/v1/orders/me/50/payment")
      .set("Cookie", cookieFor(USER));
    expect(res.status).toBe(200);
    expect(res.body.data.instructions).toBeNull();
  });
});

describe("GET /api/v1/payments/methods", () => {
  it("always exposes COD and does not expose disabled bank transfer", async () => {
    const res = await request(buildApp())
      .get("/api/v1/payments/methods")
      .set("Cookie", cookieFor(USER));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      { code: "COD", enabled: true },
      { code: "BANK_TRANSFER", enabled: false },
    ]);
  });
});

describe("POST /api/v1/webhooks/payments/:provider", () => {
  const raw = JSON.stringify({
    id: 1,
    transactionDate: "2026-10-19 10:00:00",
    accountNumber: "0123456789",
    code: "LSABC12345678",
    transferType: "in",
    transferAmount: 1000,
    referenceCode: "FT-1",
  });

  it("rejects a forged webhook before touching persistence", async () => {
    const res = await request(buildApp())
      .post("/api/v1/webhooks/payments/fake")
      .set("x-sepay-timestamp", String(Math.floor(Date.now() / 1000)))
      .set("x-sepay-signature", "sha256=bad")
      .set("Content-Type", "application/json")
      .send(raw);
    expect(res.status).toBe(401);
    expect(prismaMock.paymentWebhookEvent.create).not.toHaveBeenCalled();
  });

  it("accepts a signed webhook and stores a normalized review event", async () => {
    prismaMock.paymentWebhookEvent.findMany.mockResolvedValue([]);
    prismaMock.paymentWebhookEvent.create.mockResolvedValue({});
    prismaMock.payment.findUnique.mockResolvedValue(null);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = `sha256=${crypto.createHmac("sha256", "test-webhook-secret").update(`${timestamp}.${raw}`).digest("hex")}`;
    const res = await request(buildApp())
      .post("/api/v1/webhooks/payments/fake")
      .set("x-sepay-timestamp", String(timestamp))
      .set("x-sepay-signature", signature)
      .set("Content-Type", "application/json")
      .send(raw);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(prismaMock.paymentWebhookEvent.create.mock.calls[0][0].data).toMatchObject({
      provider: "fake",
      providerTransactionKey: "FT-1",
      reviewReason: "UNKNOWN_CODE",
    });
  });
});
