jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import { sha256Canonical } from "lib/idempotency";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";
import { ADMIN, USER, cookieFor } from "../../helpers/auth";

const product = {
  id: 1,
  name: "Asus",
  price: 100,
  image: null,
  detailDesc: "d",
  shortDesc: "s",
  quantity: 8,
  sold: 0,
  factory: "ASUS",
  target: "GAMING",
  isActive: true,
};
const movementRow = {
  id: 3,
  productId: 1,
  delta: 5,
  reason: "RESTOCK",
  orderId: null,
  actorId: ADMIN.id,
  note: null,
  balanceBefore: 3,
  balanceAfter: 8,
  receiptId: "00000000-0000-4000-8000-000000000001",
  idempotencyKey: null,
  requestHash: null,
  createdAt: new Date("2026-10-19T03:00:00Z"),
  product: { name: "Asus" },
  actor: { id: ADMIN.id, fullName: "Admin", username: "admin@gmail.com" },
  receipt: { code: "PN-20261020-ABCDEF12" },
};
const adjust = (body: object, who = ADMIN) =>
  request(buildApp())
    .post("/api/v1/admin/inventory/adjustments")
    .set("Cookie", cookieFor(who))
    .send(body);

beforeEach(() => {
  resetPrisma();
  prismaMock.product.findUnique.mockResolvedValue({ id: 1 });
  prismaMock.product.update.mockResolvedValue(product);
  prismaMock.stockMovement.create.mockResolvedValue({ id: 3 });
  prismaMock.stockMovement.findUniqueOrThrow.mockResolvedValue(movementRow);
  prismaMock.product.findUniqueOrThrow.mockResolvedValue(product);
});

describe("POST /api/v1/admin/inventory/adjustments", () => {
  it("creates an idempotent adjustment and returns created true", async () => {
    const res = await adjust(
      { productId: 1, delta: 5, reason: "RESTOCK", note: "Nhập NCC" },
      ADMIN,
    ).set("Idempotency-Key", "stock-key-1");
    expect(res.status).toBe(201);
    expect(res.body.data.created).toBe(true);
    expect(prismaMock.stockMovement.create.mock.calls[0][0].data).toMatchObject({
      idempotencyKey: "stock-key-1",
      requestHash: sha256Canonical([1, 5, "RESTOCK", "Nhập NCC"]),
    });
  });

  it("replays the same key and rejects a different payload", async () => {
    const existing = {
      ...movementRow,
      idempotencyKey: "stock-key-2",
      requestHash: sha256Canonical([1, 5, "RESTOCK", "Nhập NCC"]),
    };
    prismaMock.stockMovement.findUnique.mockResolvedValue(existing);
    const replay = await adjust(
      { productId: 1, delta: 5, reason: "RESTOCK", note: "  Nhập NCC  " },
      ADMIN,
    ).set("Idempotency-Key", "stock-key-2");
    expect(replay.status).toBe(200);
    expect(replay.body.data.created).toBe(false);
    expect(prismaMock.product.update).not.toHaveBeenCalled();

    prismaMock.stockMovement.findUnique.mockResolvedValue({
      ...existing,
      requestHash: "different",
    });
    const conflict = await adjust(
      { productId: 1, delta: 4, reason: "RESTOCK", note: "Nhập NCC" },
      ADMIN,
    ).set("Idempotency-Key", "stock-key-2");
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("restocks and returns the product and the movement", async () => {
    const res = await adjust({ productId: 1, delta: 5, reason: "RESTOCK", note: "Nhập NCC" });
    expect(res.status).toBe(201);
    expect(prismaMock.product.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { quantity: { increment: 5 } },
    });
    expect(prismaMock.stockMovement.create.mock.calls[0][0].data).toMatchObject({
      productId: 1,
      delta: 5,
      reason: "RESTOCK",
      actorId: ADMIN.id,
      note: "Nhập NCC",
    });
    expect(res.body.data.product.quantity).toBe(8);
    expect(res.body.data.movement).toMatchObject({
      id: 3,
      productName: "Asus",
      actor: { id: ADMIN.id, name: "Admin" },
      createdAt: "2026-10-19T03:00:00.000Z",
    });
  });

  it("rejects a negative restock", async () => {
    const res = await adjust({ productId: 1, delta: -1, reason: "RESTOCK", note: "Nhập hàng" });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("delta");
  });

  it("requires a note for a correction", async () => {
    const res = await adjust({ productId: 1, delta: -1, reason: "CORRECTION", note: "  " });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("note");
  });

  it("rejects zero, oversized deltas and manual-only reasons", async () => {
    expect((await adjust({ productId: 1, delta: 0, reason: "RESTOCK" })).status).toBe(400);
    expect((await adjust({ productId: 1, delta: 10001, reason: "RESTOCK" })).status).toBe(400);
    expect((await adjust({ productId: 1, delta: 1, reason: "ORDER" })).status).toBe(400);
  });

  it("returns 409 when a correction would make stock negative", async () => {
    prismaMock.product.updateMany.mockResolvedValue({ count: 0 });
    const res = await adjust({ productId: 1, delta: -99, reason: "CORRECTION", note: "Mất hàng" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("OUT_OF_STOCK");
  });

  it("returns 404 for an unknown product", async () => {
    prismaMock.product.findUnique.mockResolvedValue(null);
    expect(
      (await adjust({ productId: 9, delta: 1, reason: "RESTOCK", note: "Nhập hàng" })).status,
    ).toBe(404);
  });

  it("is admin only", async () => {
    expect((await adjust({ productId: 1, delta: 1, reason: "RESTOCK" }, USER)).status).toBe(403);
  });
});

describe("GET /api/v1/admin/inventory/movements", () => {
  it("filters by product, reason and Vietnam days, newest first", async () => {
    prismaMock.stockMovement.count.mockResolvedValue(1);
    prismaMock.stockMovement.findMany.mockResolvedValue([movementRow]);
    const res = await request(buildApp())
      .get(
        "/api/v1/admin/inventory/movements?productId=1&reason=RESTOCK&from=2026-10-19&to=2026-10-19",
      )
      .set("Cookie", cookieFor(ADMIN));
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
    const args = prismaMock.stockMovement.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      productId: 1,
      reason: "RESTOCK",
      createdAt: {
        gte: new Date("2026-10-18T17:00:00.000Z"),
        lt: new Date("2026-10-19T17:00:00.000Z"),
      },
    });
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(res.body.data[0]).toMatchObject({
      productName: "Asus",
      reason: "RESTOCK",
      delta: 5,
      balanceBefore: 3,
      balanceAfter: 8,
      receiptCode: "PN-20261020-ABCDEF12",
    });
  });
});
