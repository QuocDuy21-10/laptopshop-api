jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import { buildApp } from "../../helpers/app";
import { USER, cookieFor } from "../../helpers/auth";
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
