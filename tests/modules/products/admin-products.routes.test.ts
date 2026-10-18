jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import { prismaError, prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";
import { ADMIN, USER, cookieFor } from "../../helpers/auth";

const product = {
  id: 1,
  name: "Asus",
  price: 100,
  image: null,
  detailDesc: "d",
  shortDesc: "s",
  quantity: 5,
  sold: 0,
  factory: "ASUS",
  target: "GAMING",
};
const fields = {
  name: "Asus",
  price: "100",
  quantity: "5",
  shortDesc: "s",
  detailDesc: "d",
  factory: "ASUS",
  target: "GAMING",
};
const asAdmin = (req: request.Test) => req.set("Cookie", cookieFor(ADMIN));

beforeEach(resetPrisma);

describe("admin guard", () => {
  it("returns 401 without a session", async () => {
    expect((await request(buildApp()).get("/api/v1/admin/products")).status).toBe(401);
  });

  it("returns 403 for a USER", async () => {
    const res = await request(buildApp())
      .get("/api/v1/admin/products")
      .set("Cookie", cookieFor(USER));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/v1/admin/products", () => {
  it("creates a product from multipart fields", async () => {
    prismaMock.product.create.mockResolvedValue(product);
    let req = asAdmin(request(buildApp()).post("/api/v1/admin/products"));
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    const res = await req;
    expect(res.status).toBe(201);
    expect(prismaMock.product.create.mock.calls[0][0].data).toEqual({
      ...fields,
      price: 100,
      quantity: 5,
    });
  });

  it("rejects an unknown factory", async () => {
    const res = await asAdmin(request(buildApp()).post("/api/v1/admin/products")).send({
      ...fields,
      factory: "NOKIA",
    });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/v1/admin/products/:id", () => {
  it("updates only the sent fields", async () => {
    prismaMock.product.update.mockResolvedValue({ ...product, quantity: 0 });
    const res = await asAdmin(request(buildApp()).patch("/api/v1/admin/products/1")).send({
      quantity: 0,
    });
    expect(res.status).toBe(200);
    expect(prismaMock.product.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { quantity: 0 },
    });
  });

  it("returns 404 for a missing product", async () => {
    prismaMock.product.update.mockRejectedValue(prismaError("P2025"));
    const res = await asAdmin(request(buildApp()).patch("/api/v1/admin/products/9")).send({
      quantity: 1,
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/v1/admin/products/:id", () => {
  it("returns 409 PRODUCT_IN_USE when an order references it", async () => {
    prismaMock.orderDetail.count.mockResolvedValue(2);
    const res = await asAdmin(request(buildApp()).delete("/api/v1/admin/products/1"));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PRODUCT_IN_USE");
  });

  it("removes cart lines and the product", async () => {
    prismaMock.orderDetail.count.mockResolvedValue(0);
    const res = await asAdmin(request(buildApp()).delete("/api/v1/admin/products/1"));
    expect(res.status).toBe(204);
    expect(prismaMock.cartDetail.deleteMany).toHaveBeenCalledWith({ where: { productId: 1 } });
    expect(prismaMock.product.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });
});
