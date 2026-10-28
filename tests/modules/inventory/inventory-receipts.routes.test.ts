jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import { logger } from "lib/logger";
import { prismaError, prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";
import { ADMIN, USER, cookieFor } from "../../helpers/auth";

const product = { id: 1, name: "Asus", image: null, isActive: true };
const detail = {
  id: "00000000-0000-4000-8000-000000000001",
  code: "PN-20261020-ABCDEF12",
  supplierName: "ABC",
  status: "DRAFT",
  note: "Nhập hàng",
  createdAt: new Date("2026-10-20T03:00:00Z"),
  postedAt: null,
  version: 0,
  createdBy: { id: ADMIN.id, fullName: "Admin", username: "admin@gmail.com" },
  postedBy: null,
  items: [{ id: 1, productId: 1, quantity: 2, unitCost: 1200, product }],
  movements: [],
};
const summary = { ...detail, items: undefined, movements: undefined, _count: { items: 1 } };
const movement = {
  id: 7,
  productId: 1,
  delta: 2,
  reason: "RESTOCK",
  orderId: null,
  actorId: ADMIN.id,
  note: null,
  balanceBefore: 0,
  balanceAfter: 2,
  receiptId: detail.id,
  idempotencyKey: null,
  requestHash: null,
  createdAt: new Date("2026-10-20T03:01:00Z"),
  product: { name: "Asus" },
  actor: { id: ADMIN.id, fullName: "Admin", username: "admin@gmail.com" },
};
const endpoint = "/api/v1/admin/inventory/receipts";

beforeEach(() => {
  jest.restoreAllMocks();
  jest.spyOn(logger, "info");
  resetPrisma();
  prismaMock.product.findMany.mockResolvedValue([product]);
  prismaMock.stockReceipt.create.mockResolvedValue(detail);
  prismaMock.stockReceipt.findUnique.mockResolvedValue(detail);
  prismaMock.stockReceipt.findUniqueOrThrow.mockResolvedValue(detail);
  prismaMock.stockReceipt.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.stockReceiptItem.findMany.mockResolvedValue([
    { productId: 1, quantity: 2, unitCost: 1200 },
  ]);
  prismaMock.product.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.product.findUniqueOrThrow.mockResolvedValue({ quantity: 2 });
  prismaMock.stockMovement.create.mockResolvedValue({ id: movement.id });
  prismaMock.stockMovement.findMany.mockResolvedValue([movement]);
  prismaMock.stockReceipt.findUniqueOrThrow.mockResolvedValue({
    ...detail,
    status: "POSTED",
    postedAt: new Date("2026-10-20T03:01:00Z"),
    postedBy: detail.createdBy,
    movements: [movement],
  });
});

describe("receipt draft routes", () => {
  it("creates a draft without changing stock", async () => {
    const res = await request(buildApp())
      .post(endpoint)
      .set("Cookie", cookieFor(ADMIN))
      .send({ supplierName: "ABC", note: "Nhập hàng", items: [{ productId: 1, quantity: 2 }] });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ code: detail.code, status: "DRAFT" });
    expect(prismaMock.stockMovement.create).not.toHaveBeenCalled();
    expect(prismaMock.stockReceipt.create.mock.calls[0][0].data.items).toEqual({
      create: [{ productId: 1, quantity: 2 }],
    });
  });

  it("retries a receipt code collision but not an unrelated database error", async () => {
    prismaMock.stockReceipt.create
      .mockRejectedValueOnce(prismaError("P2002"))
      .mockResolvedValueOnce(detail);
    expect(
      (
        await request(buildApp())
          .post(endpoint)
          .set("Cookie", cookieFor(ADMIN))
          .send({ items: [{ productId: 1, quantity: 1 }] })
      ).status,
    ).toBe(201);
    expect(prismaMock.stockReceipt.create).toHaveBeenCalledTimes(2);

    resetPrisma();
    prismaMock.product.findMany.mockResolvedValue([product]);
    prismaMock.stockReceipt.create.mockRejectedValue(prismaError("P2025"));
    const res = await request(buildApp())
      .post(endpoint)
      .set("Cookie", cookieFor(ADMIN))
      .send({ items: [{ productId: 1, quantity: 1 }] });
    expect(res.status).toBe(500);
    expect(prismaMock.stockReceipt.create).toHaveBeenCalledTimes(1);
  });

  it("lists receipts with pagination and status filter", async () => {
    prismaMock.stockReceipt.count.mockResolvedValue(1);
    prismaMock.stockReceipt.findMany.mockResolvedValue([summary]);
    const res = await request(buildApp())
      .get(`${endpoint}?status=DRAFT&page=2&pageSize=10`)
      .set("Cookie", cookieFor(ADMIN));
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 2, pageSize: 10, total: 1 });
    expect(prismaMock.stockReceipt.findMany.mock.calls[0][0]).toMatchObject({
      where: { status: "DRAFT" },
      skip: 10,
      take: 10,
    });
  });

  it("gets receipt detail with mapped actors and products", async () => {
    const res = await request(buildApp())
      .get(`${endpoint}/${detail.id}`)
      .set("Cookie", cookieFor(ADMIN));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      code: detail.code,
      items: [{ productId: 1, productName: "Asus" }],
    });
  });

  it("refuses to patch a posted receipt", async () => {
    prismaMock.stockReceipt.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.stockReceipt.findUnique.mockResolvedValue({ status: "POSTED" });
    const res = await request(buildApp())
      .patch(`${endpoint}/${detail.id}`)
      .set("Cookie", cookieFor(ADMIN))
      .send({ note: "Sửa", version: 0 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_RECEIPT_STATUS");
  });

  it("is admin only", async () => {
    const res = await request(buildApp())
      .post(endpoint)
      .set("Cookie", cookieFor(USER))
      .send({ items: [{ productId: 1, quantity: 1 }] });
    expect(res.status).toBe(403);
  });

  it("posts a draft exactly once and logs metadata without payload", async () => {
    const res = await request(buildApp())
      .post(`${endpoint}/${detail.id}/post`)
      .set("Cookie", cookieFor(ADMIN))
      .send({ version: 0 });
    expect(res.status).toBe(200);
    expect(res.body.data.created).toBe(true);
    expect(prismaMock.stockReceipt.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: detail.id, status: "DRAFT", version: 0 },
      data: { status: "POSTED", version: { increment: 1 } },
    });
    expect(prismaMock.stockMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ receiptId: detail.id, reason: "RESTOCK", delta: 2 }),
    });
    const logFields = (logger.info as jest.Mock).mock.calls
      .map(([fields]) => fields)
      .find((fields) => fields && typeof fields === "object" && "receiptId" in fields) as Record<
      string,
      unknown
    >;
    expect(logFields).toEqual(expect.objectContaining({ receiptId: detail.id, actorId: ADMIN.id }));
    expect(logFields).not.toHaveProperty("note");
    expect(logFields).not.toHaveProperty("unitCost");
  });

  it("replays an already posted receipt without moving stock", async () => {
    prismaMock.stockReceipt.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.stockReceipt.findUnique.mockResolvedValue({ ...detail, status: "POSTED" });
    const res = await request(buildApp())
      .post(`${endpoint}/${detail.id}/post`)
      .set("Cookie", cookieFor(ADMIN))
      .send({ version: 0 });
    expect(res.status).toBe(200);
    expect(res.body.data.created).toBe(false);
    expect(prismaMock.stockMovement.create).not.toHaveBeenCalled();
  });

  it("returns errors for missing, empty and inactive receipts", async () => {
    prismaMock.stockReceipt.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.stockReceipt.findUnique.mockResolvedValue(null);
    expect(
      (
        await request(buildApp())
          .post(`${endpoint}/${detail.id}/post`)
          .set("Cookie", cookieFor(ADMIN))
          .send({ version: 0 })
      ).status,
    ).toBe(404);

    prismaMock.stockReceipt.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.stockReceiptItem.findMany.mockResolvedValue([]);
    const empty = await request(buildApp())
      .post(`${endpoint}/${detail.id}/post`)
      .set("Cookie", cookieFor(ADMIN))
      .send({ version: 0 });
    expect(empty.status).toBe(400);

    prismaMock.stockReceiptItem.findMany.mockResolvedValue([{ productId: 1, quantity: 2 }]);
    prismaMock.product.findMany.mockResolvedValue([]);
    const inactive = await request(buildApp())
      .post(`${endpoint}/${detail.id}/post`)
      .set("Cookie", cookieFor(ADMIN))
      .send({ version: 0 });
    expect(inactive.status).toBe(409);
    expect(inactive.body.error.code).toBe("PRODUCT_UNAVAILABLE");
  });

  it("rejects patch and post without a version", async () => {
    const patch = await request(buildApp())
      .patch(`${endpoint}/${detail.id}`)
      .set("Cookie", cookieFor(ADMIN))
      .send({ note: "Sửa" });
    expect(patch.status).toBe(400);
    const post = await request(buildApp())
      .post(`${endpoint}/${detail.id}/post`)
      .set("Cookie", cookieFor(ADMIN));
    expect(post.status).toBe(400);
    expect(prismaMock.stockReceipt.updateMany).not.toHaveBeenCalled();
  });

  it("claims a draft only at the expected version and bumps it", async () => {
    const res = await request(buildApp())
      .patch(`${endpoint}/${detail.id}`)
      .set("Cookie", cookieFor(ADMIN))
      .send({ note: "Sửa", version: 3 });
    expect(res.status).toBe(200);
    expect(prismaMock.stockReceipt.updateMany).toHaveBeenCalledWith({
      where: { id: detail.id, status: "DRAFT", version: 3 },
      data: { note: "Sửa", version: { increment: 1 } },
    });
  });

  it.each(["patch", "post"] as const)(
    "returns 409 RECEIPT_VERSION_CONFLICT on a stale %s",
    async (method) => {
      prismaMock.stockReceipt.updateMany.mockResolvedValue({ count: 0 });
      prismaMock.stockReceipt.findUnique.mockResolvedValue({ ...detail, version: 4 });
      const url = method === "patch" ? `${endpoint}/${detail.id}` : `${endpoint}/${detail.id}/post`;
      const res = await request(buildApp())
        [method](url)
        .set("Cookie", cookieFor(ADMIN))
        .send(method === "patch" ? { note: "Sửa", version: 3 } : { version: 3 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("RECEIPT_VERSION_CONFLICT");
      expect(prismaMock.stockMovement.create).not.toHaveBeenCalled();
    },
  );
});
