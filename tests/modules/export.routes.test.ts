jest.mock("config/client", () => ({ prisma: require("../helpers/prisma").prismaMock }));

import request from "supertest";
import { prismaMock, resetPrisma } from "../helpers/prisma";
import { buildApp } from "../helpers/app";
import { ADMIN, cookieFor } from "../helpers/auth";

const get = (path: string) => request(buildApp()).get(path).set("Cookie", cookieFor(ADMIN));

beforeEach(resetPrisma);

describe("CSV exports", () => {
  it("exports orders with the list filters", async () => {
    prismaMock.order.count.mockResolvedValue(1);
    prismaMock.order.findMany.mockResolvedValue([
      {
        id: 50,
        createdAt: new Date("2026-10-01T17:30:00Z"),
        completedAt: null,
        totalPrice: 200,
        status: "PENDING",
        paymentStatus: "PAYMENT_UNPAID",
        receiverName: "=cmd",
        receiverPhone: "0900000000",
        receiverAddress: "HN",
        user: { username: "a@b.co", fullName: "A" },
      },
    ]);
    const res = await get("/api/v1/admin/orders/export.csv?status=PENDING&q=An");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/csv; charset=utf-8/);
    expect(res.headers["content-disposition"]).toMatch(
      /^attachment; filename="orders-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(res.text).toContain("Mã đơn,Ngày đặt");
    expect(res.text).toContain(
      "50,2026-10-02 00:30,,A,a@b.co,'=cmd,0900000000,HN,200,PENDING,PAYMENT_UNPAID",
    );
    expect(prismaMock.order.findMany.mock.calls[0][0].where).toEqual({
      status: "PENDING",
      OR: [{ receiverName: { contains: "An" } }, { receiverPhone: { contains: "An" } }],
    });
  });

  it("refuses an export over the limit", async () => {
    prismaMock.order.count.mockResolvedValue(10_001);
    const res = await get("/api/v1/admin/orders/export.csv");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("EXPORT_TOO_LARGE");
    expect(prismaMock.order.findMany).not.toHaveBeenCalled();
  });

  it("exports products including hidden ones when asked", async () => {
    prismaMock.product.count.mockResolvedValue(1);
    prismaMock.product.findMany.mockResolvedValue([
      {
        id: 1,
        name: "Asus",
        factory: "ASUS",
        target: "GAMING",
        price: 100,
        quantity: 2,
        sold: null,
        isActive: false,
      },
    ]);
    const res = await get("/api/v1/admin/products/export.csv?isActive=false&stock=low");
    expect(res.status).toBe(200);
    expect(res.text).toContain("1,Asus,ASUS,GAMING,100,2,0,0");
    expect(prismaMock.product.findMany.mock.calls[0][0].where).toEqual({
      isActive: false,
      quantity: { lte: 5 },
    });
  });

  it("exports stock movements", async () => {
    prismaMock.stockMovement.count.mockResolvedValue(1);
    prismaMock.stockMovement.findMany.mockResolvedValue([
      {
        id: 3,
        productId: 1,
        delta: -2,
        reason: "ORDER",
        orderId: 50,
        actorId: 2,
        note: null,
        balanceBefore: 4,
        balanceAfter: 2,
        receiptId: "00000000-0000-4000-8000-000000000001",
        idempotencyKey: null,
        requestHash: null,
        createdAt: new Date("2026-10-19T03:00:00Z"),
        product: { name: "Asus" },
        actor: { id: 2, fullName: "B", username: "b@x" },
        receipt: { code: "PN-20261020-ABCDEF12" },
      },
    ]);
    const res = await get("/api/v1/admin/inventory/movements/export.csv?productId=1");
    expect(res.status).toBe(200);
    expect(res.text).toContain("2026-10-19 10:00,1,Asus,-2,4,2,ORDER,50,PN-20261020-ABCDEF12,B,");
  });
});
