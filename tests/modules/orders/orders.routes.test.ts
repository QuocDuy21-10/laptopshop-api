jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import { prismaError, prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";
import { USER, cookieFor } from "../../helpers/auth";

const receiver = { receiverName: "R", receiverAddress: "Addr", receiverPhone: "0900000000" };
const orderRow = (over: Record<string, unknown> = {}) => ({
  id: 50,
  userId: USER.id,
  totalPrice: 200,
  status: "PENDING",
  paymentMethod: "COD",
  paymentStatus: "PAYMENT_UNPAID",
  paymentRef: null,
  idempotencyKey: "k1",
  createdAt: new Date("2026-10-18T00:00:00Z"),
  ...receiver,
  orderDetails: [
    {
      id: 1,
      orderId: 50,
      productId: 1,
      price: 50,
      quantity: 2,
      product: { name: "A", image: null },
    },
    {
      id: 2,
      orderId: 50,
      productId: 2,
      price: 100,
      quantity: 1,
      product: { name: "B", image: "b.png" },
    },
  ],
  ...over,
});
const lines = [
  { productId: 1, quantity: 2, product: { price: 50, isActive: true } },
  { productId: 2, quantity: 1, product: { price: 100, isActive: true } },
];
const post = () =>
  request(buildApp())
    .post("/api/v1/orders")
    .set("Cookie", cookieFor(USER))
    .set("Idempotency-Key", "k1");

beforeEach(() => {
  resetPrisma();
  prismaMock.stockMovement.create.mockResolvedValue({ id: 900 });
  prismaMock.product.update.mockResolvedValue({ quantity: 2 });
  prismaMock.product.findUniqueOrThrow.mockResolvedValue({ quantity: 0 });
});

describe("POST /api/v1/orders", () => {
  it("rejects BANK_TRANSFER while the backend feature flag is disabled", async () => {
    prismaMock.order.findUnique.mockResolvedValue(null);
    const res = await post().send({ ...receiver, paymentMethod: "BANK_TRANSFER" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PAYMENT_METHOD_UNAVAILABLE");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("requires an Idempotency-Key header", async () => {
    const res = await request(buildApp())
      .post("/api/v1/orders")
      .set("Cookie", cookieFor(USER))
      .send(receiver);
    expect(res.status).toBe(400);
  });

  it("returns 409 CART_EMPTY for an empty cart", async () => {
    prismaMock.order.findUnique.mockResolvedValue(null);
    prismaMock.cartDetail.findMany.mockResolvedValue([]);
    const res = await post().send(receiver);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CART_EMPTY");
  });

  it("creates the order with a server-side total and clears the cart", async () => {
    prismaMock.order.findUnique.mockResolvedValue(null);
    prismaMock.cartDetail.findMany.mockResolvedValue(lines);
    prismaMock.product.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.order.create.mockResolvedValue(orderRow());
    const res = await post().send({ ...receiver, totalPrice: 1 });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ id: 50, totalPrice: 200, status: "PENDING" });
    expect(res.body.data.items[1].image).toBe("/images/product/b.png");
    expect(prismaMock.cartDetail.findMany.mock.calls[0][0]).toMatchObject({
      where: { cart: { userId: USER.id } },
      orderBy: { productId: "asc" },
    });
    expect(prismaMock.product.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 1, isActive: true, quantity: { gte: 2 } },
      data: { quantity: { decrement: 2 }, sold: { increment: 2 } },
    });
    const data = prismaMock.order.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ userId: USER.id, idempotencyKey: "k1", totalPrice: 200 });
    expect(data.orderDetails.create).toEqual([
      { productId: 1, quantity: 2, price: 50 },
      { productId: 2, quantity: 1, price: 100 },
    ]);
    expect(prismaMock.cartDetail.deleteMany).toHaveBeenCalledWith({
      where: { cart: { userId: USER.id } },
    });
    expect(prismaMock.cart.deleteMany).toHaveBeenCalledWith({ where: { userId: USER.id } });
    expect(prismaMock.orderStatusHistory.create).toHaveBeenCalledWith({
      data: { orderId: 50, fromStatus: null, toStatus: "PENDING", actorId: USER.id },
    });
    expect(prismaMock.stockMovement.create).toHaveBeenCalledWith({
      data: {
        productId: 1,
        delta: -2,
        reason: "ORDER",
        orderId: undefined,
        actorId: USER.id,
        note: undefined,
        balanceBefore: 2,
        balanceAfter: 0,
      },
    });
    expect(prismaMock.stockMovement.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [900, 900] } },
      data: { orderId: 50 },
    });
  });

  it("returns 409 PRODUCT_UNAVAILABLE and creates nothing when a line is hidden", async () => {
    prismaMock.order.findUnique.mockResolvedValue(null);
    prismaMock.cartDetail.findMany.mockResolvedValue([
      lines[0],
      { ...lines[1], product: { price: 100, isActive: false } },
    ]);
    prismaMock.product.updateMany.mockResolvedValue({ count: 1 });
    const res = await post().send(receiver);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: "PRODUCT_UNAVAILABLE",
      details: { productId: 2 },
    });
    expect(prismaMock.order.create).not.toHaveBeenCalled();
  });

  it("returns 409 OUT_OF_STOCK and creates nothing when stock is short", async () => {
    prismaMock.order.findUnique.mockResolvedValue(null);
    prismaMock.cartDetail.findMany.mockResolvedValue(lines);
    prismaMock.order.create.mockResolvedValue(orderRow());
    prismaMock.product.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const res = await post().send(receiver);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "OUT_OF_STOCK", details: { productId: 2 } });
    expect(prismaMock.cartDetail.deleteMany).not.toHaveBeenCalled();
  });

  it("replays an existing order for a reused key", async () => {
    prismaMock.order.findUnique.mockResolvedValue(orderRow());
    const res = await post().send(receiver);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(50);
    expect(prismaMock.order.findUnique.mock.calls[0][0].where).toEqual({
      userId_idempotencyKey: { userId: USER.id, idempotencyKey: "k1" },
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("replays the winner's order when a concurrent duplicate loses the race", async () => {
    prismaMock.order.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(orderRow());
    prismaMock.$transaction.mockRejectedValue(prismaError("P2002"));
    const res = await post().send(receiver);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(50);
  });
});

describe("GET /api/v1/orders/me", () => {
  it("lists only the caller's orders", async () => {
    prismaMock.order.count.mockResolvedValue(1);
    prismaMock.order.findMany.mockResolvedValue([orderRow()]);
    const res = await request(buildApp()).get("/api/v1/orders/me").set("Cookie", cookieFor(USER));
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
    expect(prismaMock.order.findMany.mock.calls[0][0].where).toEqual({ userId: USER.id });
  });

  it("returns 404 for someone else's order", async () => {
    prismaMock.order.findFirst.mockResolvedValue(null);
    const res = await request(buildApp())
      .get("/api/v1/orders/me/50")
      .set("Cookie", cookieFor(USER));
    expect(res.status).toBe(404);
    expect(prismaMock.order.findFirst.mock.calls[0][0].where).toEqual({
      id: 50,
      userId: USER.id,
    });
  });
});

describe("POST /api/v1/orders/me/:id/cancel", () => {
  const cancel = () =>
    request(buildApp()).post("/api/v1/orders/me/50/cancel").set("Cookie", cookieFor(USER));

  it("refuses to cancel a shipping order", async () => {
    prismaMock.order.findFirst.mockResolvedValue({ status: "SHIPPING" });
    const res = await cancel();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_STATUS_TRANSITION");
  });

  it("cancels a pending order and restocks each line", async () => {
    prismaMock.order.findFirst.mockResolvedValue({ status: "PENDING" });
    prismaMock.order.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.orderDetail.findMany.mockResolvedValue([
      { productId: 1, quantity: 2 },
      { productId: 2, quantity: 1 },
    ]);
    prismaMock.order.findUniqueOrThrow.mockResolvedValue(orderRow({ status: "CANCELLED" }));
    const res = await cancel();
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("CANCELLED");
    expect(prismaMock.order.updateMany).toHaveBeenCalledWith({
      where: { id: 50, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    expect(prismaMock.product.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { quantity: { increment: 2 }, sold: { decrement: 2 } },
    });
    expect(prismaMock.orderStatusHistory.create).toHaveBeenCalledWith({
      data: { orderId: 50, fromStatus: "PENDING", toStatus: "CANCELLED", actorId: USER.id },
    });
    expect(prismaMock.stockMovement.create).toHaveBeenCalledWith({
      data: {
        productId: 1,
        delta: 2,
        reason: "ORDER_CANCEL",
        orderId: 50,
        actorId: USER.id,
        note: undefined,
        balanceBefore: 0,
        balanceAfter: 2,
      },
    });
  });

  it("returns 409 when another request changed the status first", async () => {
    prismaMock.order.findFirst.mockResolvedValue({ status: "PENDING" });
    prismaMock.order.updateMany.mockResolvedValue({ count: 0 });
    const res = await cancel();
    expect(res.status).toBe(409);
    expect(prismaMock.product.update).not.toHaveBeenCalled();
    expect(prismaMock.orderStatusHistory.create).not.toHaveBeenCalled();
  });

  it("does not allow a customer to cancel a paid bank-transfer order", async () => {
    prismaMock.order.findFirst.mockResolvedValue({
      status: "PENDING",
      paymentMethod: "BANK_TRANSFER",
      paymentStatus: "PAYMENT_SUCCESS",
    });
    const res = await cancel();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PAID_ORDER_CANNOT_CANCEL");
    expect(prismaMock.order.updateMany).not.toHaveBeenCalled();
  });
});
