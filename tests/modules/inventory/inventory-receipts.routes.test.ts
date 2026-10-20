jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
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
  createdBy: { id: ADMIN.id, fullName: "Admin", username: "admin@gmail.com" },
  postedBy: null,
  items: [{ id: 1, productId: 1, quantity: 2, unitCost: 1200, product }],
  movements: [],
};
const summary = { ...detail, items: undefined, movements: undefined, _count: { items: 1 } };
const endpoint = "/api/v1/admin/inventory/receipts";

beforeEach(() => {
  resetPrisma();
  prismaMock.product.findMany.mockResolvedValue([product]);
  prismaMock.stockReceipt.create.mockResolvedValue(detail);
  prismaMock.stockReceipt.findUnique.mockResolvedValue(detail);
  prismaMock.stockReceipt.findUniqueOrThrow.mockResolvedValue(detail);
  prismaMock.stockReceipt.updateMany.mockResolvedValue({ count: 1 });
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
      .send({ note: "Sửa" });
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
});
