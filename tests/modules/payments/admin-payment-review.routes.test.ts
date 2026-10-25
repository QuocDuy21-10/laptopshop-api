jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import { prismaError, prismaMock, resetPrisma } from "../../helpers/prisma";
import { ADMIN, USER, cookieFor } from "../../helpers/auth";
import { buildApp } from "../../helpers/app";

const id = "11111111-1111-4111-8111-111111111111";
const caseRow = {
  id,
  paymentId: "22222222-2222-4222-8222-222222222222",
  reason: "RECONCILIATION_INCONCLUSIVE",
  status: "OPEN",
  version: 0,
  openedAt: new Date("2026-10-24T10:00:00.000Z"),
  nextReviewAt: new Date("2026-10-24T11:00:00.000Z"),
  resolvedAt: null,
  resolution: null,
  payment: {
    id: "22222222-2222-4222-8222-222222222222",
    orderId: 50,
    status: "REVIEW_REQUIRED",
    amount: 1000,
    transferCode: "LSABC12345678",
    expiresAt: new Date("2026-10-24T09:45:00.000Z"),
    reviewAfter: new Date("2026-10-24T10:45:00.000Z"),
    order: { status: "PENDING", paymentMethod: "BANK_TRANSFER", paymentStatus: "PAYMENT_UNPAID" },
  },
};

beforeEach(resetPrisma);

describe("admin payment review cases", () => {
  it("requires admin role to list review cases", async () => {
    const res = await request(buildApp())
      .get("/api/v1/admin/payment-review-cases")
      .set("Cookie", cookieFor(USER));
    expect(res.status).toBe(403);
  });

  it("lists open review cases for admins", async () => {
    prismaMock.paymentReviewCase.count.mockResolvedValue(1);
    prismaMock.paymentReviewCase.findMany.mockResolvedValue([caseRow]);
    const res = await request(buildApp())
      .get("/api/v1/admin/payment-review-cases?status=OPEN")
      .set("Cookie", cookieFor(ADMIN));
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ id, reason: "RECONCILIATION_INCONCLUSIVE" });
  });

  it("rejects extend without a finite future hold date and note", async () => {
    const res = await request(buildApp())
      .post(`/api/v1/admin/payment-review-cases/${id}/extend`)
      .set("Cookie", cookieFor(ADMIN))
      .send({ version: 0 });
    expect(res.status).toBe(400);
  });

  it("returns a conflict when release uses a stale version", async () => {
    prismaMock.paymentReviewCase.findUnique.mockResolvedValue(caseRow);
    prismaMock.paymentReviewCase.updateMany.mockResolvedValue({ count: 0 });
    const res = await request(buildApp())
      .post(`/api/v1/admin/payment-review-cases/${id}/release`)
      .set("Cookie", cookieFor(ADMIN))
      .send({ note: "Đã xác minh thủ công", confirmation: "RELEASE_STOCK", version: 0 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PAYMENT_REVIEW_CASE_VERSION_CONFLICT");
  });

  it("retries the complete stock release transaction after a deadlock", async () => {
    prismaMock.paymentReviewCase.findUnique.mockResolvedValue(caseRow);
    prismaMock.paymentReviewCase.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.order.findFirst.mockResolvedValue({
      status: "PENDING",
      paymentMethod: "BANK_TRANSFER",
      paymentStatus: "PAYMENT_UNPAID",
      payment: { status: "REVIEW_REQUIRED" },
    });
    prismaMock.order.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.orderDetail.findMany.mockResolvedValue([]);
    prismaMock.order.findUniqueOrThrow.mockResolvedValue({
      id: 50,
      userId: USER.id,
      status: "CANCELLED",
      paymentMethod: "BANK_TRANSFER",
      paymentStatus: "PAYMENT_FAILED",
      orderDetails: [],
    });
    prismaMock.$transaction
      .mockRejectedValueOnce(prismaError("P2034"))
      .mockImplementationOnce(async (operation: (tx: unknown) => unknown) => operation(prismaMock));

    const res = await request(buildApp())
      .post(`/api/v1/admin/payment-review-cases/${id}/release`)
      .set("Cookie", cookieFor(ADMIN))
      .send({ note: "Đã xác minh thủ công", confirmation: "RELEASE_STOCK", version: 0 });

    expect(res.status).toBe(200);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
  });
});
