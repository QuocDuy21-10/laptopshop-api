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
  isActive: true,
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

describe("GET /api/v1/admin/products", () => {
  beforeEach(() => {
    prismaMock.product.count.mockResolvedValue(0);
    prismaMock.product.findMany.mockResolvedValue([]);
  });

  it("includes hidden products when no visibility filter is sent", async () => {
    const res = await asAdmin(request(buildApp()).get("/api/v1/admin/products"));
    expect(res.status).toBe(200);
    expect(prismaMock.product.findMany.mock.calls[0][0].where).toEqual({});
  });

  it("filters by visibility and low stock", async () => {
    await asAdmin(request(buildApp()).get("/api/v1/admin/products?isActive=false&stock=low"));
    expect(prismaMock.product.findMany.mock.calls[0][0].where).toEqual({
      isActive: false,
      quantity: { lte: 5 },
    });
  });

  it("rejects an unknown visibility value", async () => {
    const res = await asAdmin(request(buildApp()).get("/api/v1/admin/products?isActive=maybe"));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/admin/products/:id", () => {
  it("returns a hidden product", async () => {
    prismaMock.product.findUnique.mockResolvedValue({ ...product, isActive: false });
    const res = await asAdmin(request(buildApp()).get("/api/v1/admin/products/1"));
    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);
  });
});

describe("POST /api/v1/admin/products", () => {
  it("creates a product from multipart fields", async () => {
    prismaMock.product.create.mockResolvedValue(product);
    prismaMock.product.update.mockResolvedValue(product);
    prismaMock.product.findUniqueOrThrow.mockResolvedValue(product);
    let req = asAdmin(request(buildApp()).post("/api/v1/admin/products"));
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    const res = await req;
    expect(res.status).toBe(201);
    expect(prismaMock.product.create.mock.calls[0][0].data).toEqual({
      ...fields,
      price: 100,
      quantity: 0,
    });
    expect(prismaMock.stockMovement.create).toHaveBeenCalledWith({
      data: {
        productId: 1,
        delta: 5,
        reason: "INITIAL",
        orderId: undefined,
        actorId: ADMIN.id,
        note: undefined,
        balanceBefore: 0,
        balanceAfter: 5,
      },
    });
  });

  it("rejects an unknown factory", async () => {
    const res = await asAdmin(request(buildApp()).post("/api/v1/admin/products")).send({
      ...fields,
      factory: "NOKIA",
    });
    expect(res.status).toBe(400);
  });

  it("stores hardware specs sent as multipart fields", async () => {
    prismaMock.product.create.mockResolvedValue(product);
    prismaMock.product.update.mockResolvedValue(product);
    prismaMock.product.findUniqueOrThrow.mockResolvedValue(product);
    const specs = {
      cpu: "Intel Core i5-11400H",
      gpu: "NVIDIA RTX 2050 4GB",
      ramGb: "16",
      storageGb: "512",
      screenSizeInch: "15.6",
      screenResolution: "1920x1080",
      refreshRateHz: "144",
      batteryWh: "48",
      weightGrams: "2300",
      warrantyMonths: "24",
    };
    let req = asAdmin(request(buildApp()).post("/api/v1/admin/products"));
    for (const [k, v] of Object.entries({ ...fields, ...specs })) req = req.field(k, v);
    const res = await req;
    expect(res.status).toBe(201);
    expect(prismaMock.product.create.mock.calls[0][0].data).toEqual({
      ...fields,
      price: 100,
      quantity: 0,
      cpu: "Intel Core i5-11400H",
      gpu: "NVIDIA RTX 2050 4GB",
      ramGb: 16,
      storageGb: 512,
      screenSizeInch: 15.6,
      screenResolution: "1920x1080",
      refreshRateHz: 144,
      batteryWh: 48,
      weightGrams: 2300,
      warrantyMonths: 24,
    });
  });

  it.each([
    ["ramGb", "0"],
    ["ramGb", "8.5"],
    ["screenSizeInch", "30"],
    ["weightGrams", "abc"],
  ])("rejects %s=%s", async (key, value) => {
    let req = asAdmin(request(buildApp()).post("/api/v1/admin/products"));
    for (const [k, v] of Object.entries({ ...fields, [key]: value })) req = req.field(k, v);
    expect((await req).status).toBe(400);
  });
});

describe("PATCH /api/v1/admin/products/:id", () => {
  it("clears specs sent as empty multipart strings instead of storing 0", async () => {
    prismaMock.product.update.mockResolvedValue(product);
    const res = await asAdmin(request(buildApp()).patch("/api/v1/admin/products/1"))
      .field("ramGb", "")
      .field("cpu", "");
    expect(res.status).toBe(200);
    expect(prismaMock.product.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { ramGb: null, cpu: null },
    });
  });

  it("updates only the sent fields", async () => {
    prismaMock.product.update.mockResolvedValue({ ...product, price: 200 });
    const res = await asAdmin(request(buildApp()).patch("/api/v1/admin/products/1")).send({
      price: 200,
    });
    expect(res.status).toBe(200);
    expect(prismaMock.product.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { price: 200 },
    });
  });

  it("ignores a quantity sent to the product endpoint", async () => {
    prismaMock.product.update.mockResolvedValue(product);
    await asAdmin(request(buildApp()).patch("/api/v1/admin/products/1")).send({
      name: "X",
      quantity: 99,
    });
    expect(prismaMock.product.update.mock.calls[0][0].data).toEqual({ name: "X" });
  });

  it("hides a product from a multipart string", async () => {
    prismaMock.product.update.mockResolvedValue({ ...product, isActive: false });
    const res = await asAdmin(request(buildApp()).patch("/api/v1/admin/products/1")).field(
      "isActive",
      "false",
    );
    expect(res.status).toBe(200);
    expect(prismaMock.product.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { isActive: false },
    });
  });

  it("accepts a JSON boolean", async () => {
    prismaMock.product.update.mockResolvedValue(product);
    await asAdmin(request(buildApp()).patch("/api/v1/admin/products/1")).send({ isActive: true });
    expect(prismaMock.product.update.mock.calls[0][0].data).toEqual({ isActive: true });
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
    prismaMock.stockMovement.count.mockResolvedValue(0);
    const res = await asAdmin(request(buildApp()).delete("/api/v1/admin/products/1"));
    expect(res.status).toBe(204);
    expect(prismaMock.cartDetail.deleteMany).toHaveBeenCalledWith({ where: { productId: 1 } });
    expect(prismaMock.stockMovement.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.product.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it("returns 409 PRODUCT_IN_USE when a stock movement references it", async () => {
    prismaMock.orderDetail.count.mockResolvedValue(0);
    prismaMock.stockMovement.count.mockResolvedValue(1);
    const res = await asAdmin(request(buildApp()).delete("/api/v1/admin/products/1"));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PRODUCT_IN_USE");
    expect(prismaMock.stockMovement.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.product.delete).not.toHaveBeenCalled();
  });
});
