jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";
import { ADMIN, cookieFor } from "../../helpers/auth";

beforeEach(resetPrisma);

describe("admin payment event review", () => {
  it("lists review events for admins", async () => {
    prismaMock.paymentWebhookEvent.count.mockResolvedValue(1);
    prismaMock.paymentWebhookEvent.findMany.mockResolvedValue([
      {
        id: "event-1",
        provider: "fake",
        source: "WEBHOOK",
        providerEventId: "1",
        providerTransactionKey: "tx-1",
        paymentId: null,
        direction: "IN",
        amount: 1000,
        currency: "VND",
        transferCode: "OTHER",
        accountNumber: "0123456789",
        occurredAt: new Date("2026-10-19T00:00:00Z"),
        status: "REVIEW_REQUIRED",
        reviewReason: "UNKNOWN_CODE",
        note: null,
        receivedAt: new Date("2026-10-19T00:00:00Z"),
        resolvedAt: null,
        resolvedById: null,
      },
    ]);
    const res = await request(buildApp())
      .get("/api/v1/admin/payment-events?status=REVIEW_REQUIRED")
      .set("Cookie", cookieFor(ADMIN));
    expect(res.status).toBe(200);
    expect(res.body.data[0].reviewReason).toBe("UNKNOWN_CODE");
  });

  it("requires a note to resolve an event", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    prismaMock.paymentWebhookEvent.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.paymentWebhookEvent.findUnique.mockResolvedValue({
      id,
      status: "RESOLVED",
    });
    const res = await request(buildApp())
      .post(`/api/v1/admin/payment-events/${id}/resolve`)
      .set("Cookie", cookieFor(ADMIN))
      .send({ note: "Đã kiểm tra với ngân hàng" });
    expect(res.status).toBe(200);
    expect(prismaMock.paymentWebhookEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id, status: "REVIEW_REQUIRED" } }),
    );
  });
});
