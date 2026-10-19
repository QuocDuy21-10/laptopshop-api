jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";
import { ADMIN, cookieFor } from "../../helpers/auth";

const orderRow = (over: Record<string, unknown> = {}) => ({
  id: 50,
  userId: 1,
  totalPrice: 200,
  status: "SHIPPING",
  paymentMethod: "COD",
  paymentStatus: "PAYMENT_UNPAID",
  paymentRef: null,
  idempotencyKey: "k",
  createdAt: new Date("2026-10-18T00:00:00Z"),
  completedAt: null,
  receiverName: "R",
  receiverAddress: "A",
  receiverPhone: "0900000000",
  orderDetails: [],
  user: { id: 1, username: "a@b.co", fullName: "A" },
  ...over,
});
const asAdmin = (req: request.Test) => req.set("Cookie", cookieFor(ADMIN));

beforeEach(resetPrisma);

describe("GET /api/v1/admin/orders", () => {
  it("filters by status and includes the buyer", async () => {
    prismaMock.order.count.mockResolvedValue(1);
    prismaMock.order.findMany.mockResolvedValue([orderRow()]);
    const res = await asAdmin(request(buildApp()).get("/api/v1/admin/orders?status=SHIPPING"));
    expect(res.status).toBe(200);
    expect(res.body.data[0].user.username).toBe("a@b.co");
    expect(prismaMock.order.findMany.mock.calls[0][0].where).toEqual({ status: "SHIPPING" });
  });

  const whereOf = async (qs: string) => {
    prismaMock.order.count.mockResolvedValue(0);
    prismaMock.order.findMany.mockResolvedValue([]);
    const res = await asAdmin(request(buildApp()).get(`/api/v1/admin/orders?${qs}`));
    expect(res.status).toBe(200);
    return prismaMock.order.findMany.mock.calls[0][0].where;
  };

  it("searches a numeric q by order id or receiver phone", async () => {
    expect(await whereOf("q=50")).toEqual({
      OR: [{ id: 50 }, { receiverPhone: { contains: "50" } }],
    });
  });

  it("searches a text q by receiver name or phone", async () => {
    expect(await whereOf("q=%20An%20")).toEqual({
      OR: [{ receiverName: { contains: "An" } }, { receiverPhone: { contains: "An" } }],
    });
  });

  it("does not treat a number too long for an id as an id", async () => {
    expect(await whereOf("q=0900000000")).toEqual({
      OR: [
        { receiverName: { contains: "0900000000" } },
        { receiverPhone: { contains: "0900000000" } },
      ],
    });
  });

  it("filters by Vietnam calendar days, inclusive of the end day", async () => {
    expect(await whereOf("from=2026-10-01&to=2026-10-19")).toEqual({
      createdAt: {
        gte: new Date("2026-09-30T17:00:00.000Z"),
        lt: new Date("2026-10-19T17:00:00.000Z"),
      },
    });
  });

  it("filters by buyer", async () => {
    expect(await whereOf("userId=7&status=PENDING")).toEqual({ status: "PENDING", userId: 7 });
  });

  it("rejects a range that ends before it starts", async () => {
    const res = await asAdmin(
      request(buildApp()).get("/api/v1/admin/orders?from=2026-10-19&to=2026-10-01"),
    );
    expect(res.status).toBe(400);
  });

  it("rejects an impossible date", async () => {
    const res = await asAdmin(request(buildApp()).get("/api/v1/admin/orders?from=2026-02-30"));
    expect(res.status).toBe(400);
  });

  it("rejects an unknown status", async () => {
    const res = await asAdmin(request(buildApp()).get("/api/v1/admin/orders?status=LOST"));
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/v1/admin/orders/:id/status", () => {
  it("completes a shipping order and marks it paid", async () => {
    prismaMock.order.findFirst.mockResolvedValue({ status: "SHIPPING" });
    prismaMock.order.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.order.findUniqueOrThrow.mockResolvedValue(orderRow({ status: "COMPLETED" }));
    const res = await asAdmin(request(buildApp()).patch("/api/v1/admin/orders/50/status")).send({
      status: "COMPLETED",
    });
    expect(res.status).toBe(200);
    expect(prismaMock.order.updateMany).toHaveBeenCalledWith({
      where: { id: 50, status: "SHIPPING" },
      data: {
        status: "COMPLETED",
        paymentStatus: "PAYMENT_SUCCESS",
        completedAt: expect.any(Date),
      },
    });
    expect(prismaMock.orderStatusHistory.create).toHaveBeenCalledWith({
      data: { orderId: 50, fromStatus: "SHIPPING", toStatus: "COMPLETED", actorId: ADMIN.id },
    });
  });

  it("returns 409 for an invalid transition", async () => {
    prismaMock.order.findFirst.mockResolvedValue({ status: "COMPLETED" });
    const res = await asAdmin(request(buildApp()).patch("/api/v1/admin/orders/50/status")).send({
      status: "PENDING",
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_STATUS_TRANSITION");
  });
});

describe("GET /api/v1/admin/orders/:id", () => {
  it("returns the status history with the actor's name", async () => {
    prismaMock.order.findUnique.mockResolvedValue(
      orderRow({
        history: [
          {
            id: 1,
            orderId: 50,
            fromStatus: null,
            toStatus: "PENDING",
            actorId: 1,
            createdAt: new Date("2026-10-18T00:00:00Z"),
            actor: { id: 1, fullName: null, username: "a@b.co" },
          },
          {
            id: 2,
            orderId: 50,
            fromStatus: "PENDING",
            toStatus: "SHIPPING",
            actorId: null,
            createdAt: new Date("2026-10-18T01:00:00Z"),
            actor: null,
          },
        ],
      }),
    );
    const res = await asAdmin(request(buildApp()).get("/api/v1/admin/orders/50"));
    expect(res.status).toBe(200);
    expect(res.body.data.history).toEqual([
      {
        fromStatus: null,
        toStatus: "PENDING",
        actor: { id: 1, name: "a@b.co" },
        createdAt: "2026-10-18T00:00:00.000Z",
      },
      {
        fromStatus: "PENDING",
        toStatus: "SHIPPING",
        actor: null,
        createdAt: "2026-10-18T01:00:00.000Z",
      },
    ]);
    expect(prismaMock.order.findUnique.mock.calls[0][0].include.history).toBeDefined();
  });

  it("keeps history out of the list", async () => {
    prismaMock.order.count.mockResolvedValue(1);
    prismaMock.order.findMany.mockResolvedValue([orderRow()]);
    const res = await asAdmin(request(buildApp()).get("/api/v1/admin/orders"));
    expect(res.body.data[0]).not.toHaveProperty("history");
    expect(res.body.data[0].completedAt).toBeNull();
  });
});
