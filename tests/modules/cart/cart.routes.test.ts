jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";
import { USER, cookieFor } from "../../helpers/auth";

const product = {
  id: 3,
  name: "Dell",
  price: 100,
  image: null,
  detailDesc: "d",
  shortDesc: "s",
  quantity: 5,
  sold: 0,
  factory: "DELL",
  target: "GAMING",
};
const auth = () => cookieFor(USER);

beforeEach(() => {
  resetPrisma();
  prismaMock.cartDetail.findMany.mockResolvedValue([{ id: 7, quantity: 2, product }]);
});

describe("GET /api/v1/cart", () => {
  it("returns 401 without a session", async () => {
    expect((await request(buildApp()).get("/api/v1/cart")).status).toBe(401);
  });

  it("computes totals from current prices for the caller's cart only", async () => {
    const res = await request(buildApp()).get("/api/v1/cart").set("Cookie", auth());
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      items: [{ id: 7, quantity: 2, lineTotal: 200, product: { id: 3 } }],
      itemCount: 2,
      subtotal: 200,
    });
    expect(prismaMock.cartDetail.findMany.mock.calls[0][0].where).toEqual({
      cart: { userId: USER.id },
    });
  });
});

describe("POST /api/v1/cart/items", () => {
  it("adds to the line for this cart and product", async () => {
    prismaMock.product.findUnique.mockResolvedValue({ quantity: 5, isActive: true });
    prismaMock.cart.upsert.mockResolvedValue({ id: 11 });
    prismaMock.cartDetail.upsert.mockResolvedValue({ quantity: 3 });
    const res = await request(buildApp())
      .post("/api/v1/cart/items")
      .set("Cookie", auth())
      .send({ productId: 3, quantity: 1, cartId: 999 });
    expect(res.status).toBe(200);
    expect(prismaMock.cart.upsert.mock.calls[0][0].where).toEqual({ userId: USER.id });
    expect(prismaMock.cartDetail.upsert.mock.calls[0][0]).toMatchObject({
      where: { cartId_productId: { cartId: 11, productId: 3 } },
      update: { quantity: { increment: 1 } },
    });
  });

  it("returns 409 OUT_OF_STOCK when the line would exceed stock", async () => {
    prismaMock.product.findUnique.mockResolvedValue({ quantity: 5, isActive: true });
    prismaMock.cart.upsert.mockResolvedValue({ id: 11 });
    prismaMock.cartDetail.upsert.mockResolvedValue({ quantity: 6 });
    const res = await request(buildApp())
      .post("/api/v1/cart/items")
      .set("Cookie", auth())
      .send({ productId: 3, quantity: 2 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "OUT_OF_STOCK", details: { productId: 3 } });
  });

  it("returns 409 PRODUCT_UNAVAILABLE for a hidden product", async () => {
    prismaMock.product.findUnique.mockResolvedValue({ quantity: 5, isActive: false });
    const res = await request(buildApp())
      .post("/api/v1/cart/items")
      .set("Cookie", auth())
      .send({ productId: 3, quantity: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: "PRODUCT_UNAVAILABLE",
      details: { productId: 3 },
    });
    expect(prismaMock.cartDetail.upsert).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown product", async () => {
    prismaMock.product.findUnique.mockResolvedValue(null);
    const res = await request(buildApp())
      .post("/api/v1/cart/items")
      .set("Cookie", auth())
      .send({ productId: 3, quantity: 1 });
    expect(res.status).toBe(404);
  });

  it("returns 400 for quantity 0", async () => {
    const res = await request(buildApp())
      .post("/api/v1/cart/items")
      .set("Cookie", auth())
      .send({ productId: 3, quantity: 0 });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/v1/cart/items/:id", () => {
  it("returns 404 for a line outside the caller's cart", async () => {
    prismaMock.cartDetail.findFirst.mockResolvedValue(null);
    const res = await request(buildApp())
      .patch("/api/v1/cart/items/7")
      .set("Cookie", auth())
      .send({ quantity: 2 });
    expect(res.status).toBe(404);
    expect(prismaMock.cartDetail.findFirst.mock.calls[0][0].where).toEqual({
      id: 7,
      cart: { userId: USER.id },
    });
  });

  it("returns 409 when the quantity exceeds stock", async () => {
    prismaMock.cartDetail.findFirst.mockResolvedValue({
      productId: 3,
      product: { quantity: 5, isActive: true },
    });
    const res = await request(buildApp())
      .patch("/api/v1/cart/items/7")
      .set("Cookie", auth())
      .send({ quantity: 9 });
    expect(res.status).toBe(409);
  });

  it("returns 409 PRODUCT_UNAVAILABLE for a hidden product", async () => {
    prismaMock.cartDetail.findFirst.mockResolvedValue({
      productId: 3,
      product: { quantity: 5, isActive: false },
    });
    const res = await request(buildApp())
      .patch("/api/v1/cart/items/7")
      .set("Cookie", auth())
      .send({ quantity: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PRODUCT_UNAVAILABLE");
    expect(prismaMock.cartDetail.update).not.toHaveBeenCalled();
  });

  it("sets the quantity", async () => {
    prismaMock.cartDetail.findFirst.mockResolvedValue({
      productId: 3,
      product: { quantity: 5, isActive: true },
    });
    const res = await request(buildApp())
      .patch("/api/v1/cart/items/7")
      .set("Cookie", auth())
      .send({ quantity: 4 });
    expect(res.status).toBe(200);
    expect(prismaMock.cartDetail.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { quantity: 4 },
    });
  });
});

describe("DELETE /api/v1/cart/items/:id", () => {
  it("returns 404 for a line outside the caller's cart", async () => {
    prismaMock.cartDetail.deleteMany.mockResolvedValue({ count: 0 });
    const res = await request(buildApp()).delete("/api/v1/cart/items/7").set("Cookie", auth());
    expect(res.status).toBe(404);
  });

  it("deletes the caller's line", async () => {
    prismaMock.cartDetail.deleteMany.mockResolvedValue({ count: 1 });
    const res = await request(buildApp()).delete("/api/v1/cart/items/7").set("Cookie", auth());
    expect(res.status).toBe(204);
    expect(prismaMock.cartDetail.deleteMany).toHaveBeenCalledWith({
      where: { id: 7, cart: { userId: USER.id } },
    });
  });
});
