jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";

const product = {
  id: 1,
  name: "Asus",
  price: 17_490_000,
  image: "a.png",
  detailDesc: "d",
  shortDesc: "s",
  quantity: 5,
  sold: 0,
  factory: "ASUS",
  target: "GAMING",
};

beforeEach(resetPrisma);

describe("GET /api/v1/products", () => {
  it("returns a page with meta and public image paths", async () => {
    prismaMock.product.count.mockResolvedValue(1);
    prismaMock.product.findMany.mockResolvedValue([product]);
    const res = await request(buildApp()).get("/api/v1/products");
    expect(res.status).toBe(200);
    expect(res.body.data[0].image).toBe("/images/product/a.png");
    expect(res.body.meta).toEqual({ page: 1, pageSize: 10, total: 1, totalPages: 1 });
    expect(prismaMock.product.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { id: "asc" },
      skip: 0,
      take: 10,
    });
  });

  it("applies factory, target, price and sort filters", async () => {
    prismaMock.product.count.mockResolvedValue(0);
    prismaMock.product.findMany.mockResolvedValue([]);
    await request(buildApp()).get(
      "/api/v1/products?factory=ASUS,DELL&target=GAMING&price=under-10m,over-20m&sort=price_desc&page=2&pageSize=5",
    );
    expect(prismaMock.product.findMany).toHaveBeenCalledWith({
      where: {
        factory: { in: ["ASUS", "DELL"] },
        target: { in: ["GAMING"] },
        OR: [{ price: { lt: 10_000_000 } }, { price: { gt: 20_000_000 } }],
      },
      orderBy: { price: "desc" },
      skip: 5,
      take: 5,
    });
  });

  it("searches by name", async () => {
    prismaMock.product.count.mockResolvedValue(0);
    prismaMock.product.findMany.mockResolvedValue([]);
    await request(buildApp()).get("/api/v1/products?q=%20asus%20");
    expect(prismaMock.product.findMany.mock.calls[0][0].where).toEqual({
      name: { contains: "asus" },
    });
  });

  it("rejects a search longer than 100 characters", async () => {
    const res = await request(buildApp()).get(`/api/v1/products?q=${"a".repeat(101)}`);
    expect(res.status).toBe(400);
  });

  it("rejects an unknown factory", async () => {
    const res = await request(buildApp()).get("/api/v1/products?factory=NOKIA");
    expect(res.status).toBe(400);
  });

  it("caps pageSize at 50", async () => {
    expect((await request(buildApp()).get("/api/v1/products?pageSize=51")).status).toBe(400);
  });
});

describe("GET /api/v1/products/:id", () => {
  it("returns the product", async () => {
    prismaMock.product.findUnique.mockResolvedValue(product);
    const res = await request(buildApp()).get("/api/v1/products/1");
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Asus");
  });

  it("returns 404 when missing", async () => {
    prismaMock.product.findUnique.mockResolvedValue(null);
    const res = await request(buildApp()).get("/api/v1/products/9");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 400 for a non-numeric id", async () => {
    expect((await request(buildApp()).get("/api/v1/products/abc")).status).toBe(400);
  });
});

describe("GET /api/v1/products/filters", () => {
  it("returns the filter options", async () => {
    const res = await request(buildApp()).get("/api/v1/products/filters");
    expect(res.status).toBe(200);
    expect(res.body.data.factoryOptions).toContainEqual({ name: "Asus", value: "ASUS" });
    expect(res.body.data.targetOptions.length).toBeGreaterThan(0);
  });
});
