jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import { createHash } from "node:crypto";
import request from "supertest";
import { buildApp } from "../../helpers/app";
import { ADMIN, USER, cookieFor } from "../../helpers/auth";
import { prismaMock, resetPrisma } from "../../helpers/prisma";

beforeEach(resetPrisma);

describe("GET /api/v1/after-sales/devices", () => {
  it("scopes eligible devices to completed paid orders and reports available units", async () => {
    prismaMock.orderDetail.count.mockResolvedValue(1);
    prismaMock.orderDetail.findMany.mockResolvedValue([
      {
        id: 12,
        orderId: 50,
        productId: 7,
        quantity: 2,
        warrantyMonthsSnapshot: 24,
        warrantyStartAt: new Date("2026-01-01T00:00:00.000Z"),
        warrantyEndAt: new Date("2028-01-01T00:00:00.000Z"),
        warrantyPolicySource: "CHECKOUT_SNAPSHOT",
        order: {
          id: 50,
          userId: USER.id,
          status: "COMPLETED",
          paymentStatus: "PAYMENT_SUCCESS",
          completedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
        product: { id: 7, name: "Laptop A", image: null },
        serviceRequestItems: [{ id: 90 }],
      },
    ]);

    const res = await request(buildApp())
      .get("/api/v1/after-sales/devices?type=WARRANTY&page=1&pageSize=10")
      .set("Cookie", cookieFor(USER));

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({
      orderDetailId: 12,
      orderId: 50,
      quantity: 2,
      activeCount: 1,
      availableCount: 1,
      coverage: "IN_WARRANTY",
      allowed: true,
    });
    expect(res.body.data[0]).not.toHaveProperty("receiverPhone");
    expect(prismaMock.orderDetail.findMany.mock.calls[0][0].where).toMatchObject({
      order: { userId: USER.id, status: "COMPLETED", paymentStatus: "PAYMENT_SUCCESS" },
    });
  });

  it("allows technical support for an expired device but blocks warranty", async () => {
    prismaMock.orderDetail.count.mockResolvedValue(1);
    prismaMock.orderDetail.findMany.mockResolvedValue([
      {
        id: 13,
        orderId: 51,
        productId: 8,
        quantity: 1,
        warrantyMonthsSnapshot: 12,
        warrantyStartAt: new Date("2024-01-01T00:00:00.000Z"),
        warrantyEndAt: new Date("2025-01-01T00:00:00.000Z"),
        warrantyPolicySource: "CHECKOUT_SNAPSHOT",
        order: {
          id: 51,
          userId: USER.id,
          status: "COMPLETED",
          paymentStatus: "PAYMENT_SUCCESS",
          completedAt: new Date("2024-01-01T00:00:00.000Z"),
        },
        product: { id: 8, name: "Laptop B", image: null },
        serviceRequestItems: [],
      },
    ]);

    const res = await request(buildApp())
      .get("/api/v1/after-sales/devices?type=TECHNICAL_SUPPORT")
      .set("Cookie", cookieFor(USER));

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ coverage: "OUT_OF_WARRANTY", allowed: true });
    expect(res.body.data[0].allowedRequestTypes).toEqual(["TECHNICAL_SUPPORT"]);
  });
});

describe("POST /api/v1/after-sales", () => {
  const input = {
    type: "TECHNICAL_SUPPORT",
    subject: "Cần hỗ trợ driver",
    items: [
      { orderDetailId: 12, deviceLabel: "Thiết bị 1", issueDescription: "Thiếu driver" },
      { orderDetailId: 13, deviceLabel: "Thiết bị 2", issueDescription: "Không nhận wifi" },
    ],
  };

  it("creates one request containing devices from different paid orders", async () => {
    prismaMock.serviceRequest.findUnique.mockResolvedValue(null);
    prismaMock.$queryRaw.mockResolvedValue([{ id: 12 }, { id: 13 }]);
    prismaMock.orderDetail.findMany.mockResolvedValue([
      {
        id: 12,
        orderId: 50,
        productId: 7,
        quantity: 1,
        warrantyMonthsSnapshot: null,
        warrantyStartAt: null,
        warrantyEndAt: null,
        warrantyPolicySource: "UNAVAILABLE",
        order: { id: 50, userId: USER.id, status: "COMPLETED", paymentStatus: "PAYMENT_SUCCESS" },
        product: { name: "Laptop A" },
        serviceRequestItems: [],
      },
      {
        id: 13,
        orderId: 51,
        productId: 8,
        quantity: 1,
        warrantyMonthsSnapshot: null,
        warrantyStartAt: null,
        warrantyEndAt: null,
        warrantyPolicySource: "UNAVAILABLE",
        order: { id: 51, userId: USER.id, status: "COMPLETED", paymentStatus: "PAYMENT_SUCCESS" },
        product: { name: "Laptop B" },
        serviceRequestItems: [],
      },
    ]);
    prismaMock.serviceRequest.create.mockResolvedValue({ id: 90 });
    prismaMock.serviceRequest.findUniqueOrThrow.mockResolvedValue({
      id: 90,
      code: "AS-TEST-90",
      userId: USER.id,
      type: "TECHNICAL_SUPPORT",
      status: "SUBMITTED",
      subject: input.subject,
      previousRequestId: null,
      createdAt: new Date("2026-10-23T00:00:00.000Z"),
      updatedAt: new Date("2026-10-23T00:00:00.000Z"),
      closedAt: null,
      items: [
        {
          id: 1,
          orderDetailId: 12,
          orderDetail: { orderId: 50 },
          position: 0,
          productNameSnapshot: "Laptop A",
          deviceLabel: "Thiết bị 1",
          serialNumber: null,
          issueDescription: "Thiếu driver",
          coverageAtCreation: "REQUIRES_VERIFICATION",
          status: "SUBMITTED",
          resolution: null,
          version: 1,
          resolvedAt: null,
          returnedAt: null,
          confirmationDueAt: null,
          customerConfirmedAt: null,
          closedAt: null,
          closeReason: null,
          quotes: [],
        },
        {
          id: 2,
          orderDetailId: 13,
          orderDetail: { orderId: 51 },
          position: 1,
          productNameSnapshot: "Laptop B",
          deviceLabel: "Thiết bị 2",
          serialNumber: null,
          issueDescription: "Không nhận wifi",
          coverageAtCreation: "REQUIRES_VERIFICATION",
          status: "SUBMITTED",
          resolution: null,
          version: 1,
          resolvedAt: null,
          returnedAt: null,
          confirmationDueAt: null,
          customerConfirmedAt: null,
          closedAt: null,
          closeReason: null,
          quotes: [],
        },
      ],
      events: [],
    });

    const res = await request(buildApp())
      .post("/api/v1/after-sales")
      .set("Cookie", cookieFor(USER))
      .set("Idempotency-Key", "after-sales-create-1")
      .send(input);

    expect(res.status).toBe(201);
    expect(
      res.body.data.items.map((item: { orderDetailId: number }) => item.orderDetailId),
    ).toEqual([12, 13]);
  });

  it("replays an idempotent request without creating another row", async () => {
    prismaMock.serviceRequest.findUnique.mockResolvedValue({
      id: 90,
      requestHash: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
    } as never);
    prismaMock.serviceRequest.findUniqueOrThrow.mockResolvedValue({
      id: 90,
      code: "AS-TEST-90",
      userId: USER.id,
      type: "TECHNICAL_SUPPORT",
      status: "SUBMITTED",
      subject: input.subject,
      previousRequestId: null,
      createdAt: new Date("2026-10-23T00:00:00.000Z"),
      updatedAt: new Date("2026-10-23T00:00:00.000Z"),
      closedAt: null,
      items: [],
      events: [],
    });

    const res = await request(buildApp())
      .post("/api/v1/after-sales")
      .set("Cookie", cookieFor(USER))
      .set("Idempotency-Key", "after-sales-create-1")
      .send(input);

    expect(res.status).toBe(200);
    expect(prismaMock.serviceRequest.create).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/after-sales", () => {
  const requestRow = {
    id: 90,
    code: "AS-TEST-90",
    userId: USER.id,
    type: "TECHNICAL_SUPPORT",
    status: "CLOSED",
    subject: "Hỗ trợ đã xong",
    previousRequestId: 12,
    createdAt: new Date("2026-10-23T00:00:00.000Z"),
    updatedAt: new Date("2026-10-23T01:00:00.000Z"),
    closedAt: new Date("2026-10-23T01:00:00.000Z"),
    items: [],
    events: [
      {
        id: 1,
        serviceRequestItemId: null,
        kind: "REQUEST_CREATED",
        visibility: "PUBLIC",
        fromStatus: null,
        toStatus: null,
        body: "Hỗ trợ",
        createdAt: new Date("2026-10-23T00:00:00.000Z"),
      },
    ],
    previousRequest: {
      id: 12,
      code: "AS-OLD",
      type: "TECHNICAL_SUPPORT",
      status: "CLOSED",
      subject: "Cũ",
      createdAt: new Date("2026-10-22T00:00:00.000Z"),
    },
    followUps: [],
  };

  it("lists only the current customer's requests", async () => {
    prismaMock.serviceRequest.count.mockResolvedValue(1);
    prismaMock.serviceRequest.findMany.mockResolvedValue([requestRow]);

    const res = await request(buildApp())
      .get("/api/v1/after-sales?page=1&pageSize=10")
      .set("Cookie", cookieFor(USER));

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ id: 90, code: "AS-TEST-90", status: "CLOSED" });
    expect(prismaMock.serviceRequest.findMany.mock.calls[0][0].where).toEqual({ userId: USER.id });
  });

  it("returns a public detail and hides internal events", async () => {
    prismaMock.serviceRequest.findFirst.mockResolvedValue(requestRow);

    const res = await request(buildApp())
      .get("/api/v1/after-sales/90")
      .set("Cookie", cookieFor(USER));

    expect(res.status).toBe(200);
    expect(res.body.data.previousRequest.id).toBe(12);
    expect(
      res.body.data.events.every(
        (event: { visibility?: string }) => event.visibility !== "INTERNAL",
      ),
    ).toBe(true);
    expect(res.body.data.events[0]).not.toHaveProperty("objectKey");
  });

  it("returns 404 for another customer's request", async () => {
    prismaMock.serviceRequest.findFirst.mockResolvedValue(null);
    const res = await request(buildApp())
      .get("/api/v1/after-sales/90")
      .set("Cookie", cookieFor(USER));
    expect(res.status).toBe(404);
  });
});

describe("admin after-sales management", () => {
  it("filters admin requests by type and status", async () => {
    prismaMock.serviceRequest.count.mockResolvedValue(0);
    prismaMock.serviceRequest.findMany.mockResolvedValue([]);
    const res = await request(buildApp())
      .get("/api/v1/admin/after-sales?type=WARRANTY&status=REVIEWING&page=1&pageSize=10")
      .set("Cookie", cookieFor(ADMIN));
    expect(res.status).toBe(200);
    expect(prismaMock.serviceRequest.findMany.mock.calls[0][0].where).toMatchObject({
      type: "WARRANTY",
      status: "REVIEWING",
    });
  });

  it("lists admin assignees and permits unassignment", async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: ADMIN.id, fullName: "Admin", username: "admin@test.local" },
    ]);
    const assignees = await request(buildApp())
      .get("/api/v1/admin/after-sales/assignees")
      .set("Cookie", cookieFor(ADMIN));
    expect(assignees.status).toBe(200);
    expect(assignees.body.data[0]).toMatchObject({ id: ADMIN.id, name: "Admin" });

    prismaMock.serviceRequest.findUnique.mockResolvedValue({
      id: 90,
      version: 3,
      assignedToId: ADMIN.id,
    });
    prismaMock.serviceRequest.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.serviceRequestEvent.create.mockResolvedValue({});
    prismaMock.serviceRequest.findUniqueOrThrow.mockResolvedValue({
      id: 90,
      code: "AS-90",
      userId: USER.id,
      type: "WARRANTY",
      status: "REVIEWING",
      subject: "X",
      previousRequestId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      closedAt: null,
      items: [],
      events: [],
      previousRequest: null,
      followUps: [],
    });
    const unassigned = await request(buildApp())
      .patch("/api/v1/admin/after-sales/90/assign")
      .set("Cookie", cookieFor(ADMIN))
      .send({ assignedToId: null, expectedVersion: 3 });
    expect(unassigned.status).toBe(200);
    expect(prismaMock.serviceRequest.updateMany.mock.calls[0][0].data.assignedToId).toBeNull();
  });
});
