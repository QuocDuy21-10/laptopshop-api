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
  isActive: true,
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
      where: { isActive: true },
      orderBy: [{ id: "asc" }],
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
        isActive: true,
        AND: [
          { factory: { in: ["ASUS", "DELL"] } },
          { target: { in: ["GAMING"] } },
          { OR: [{ price: { lt: 10_000_000 } }, { price: { gt: 20_000_000 } }] },
        ],
      },
      orderBy: [{ price: "desc" }, { id: "asc" }],
      skip: 5,
      take: 5,
    });
  });

  it("searches by name", async () => {
    prismaMock.product.count.mockResolvedValue(0);
    prismaMock.product.findMany.mockResolvedValue([]);
    await request(buildApp()).get("/api/v1/products?q=%20asus%20");
    expect(prismaMock.product.findMany.mock.calls[0][0].where).toEqual({
      isActive: true,
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

  it("rejects a repeated advanced filter query parameter", async () => {
    const res = await request(buildApp()).get("/api/v1/products?cpuBrand=INTEL&cpuBrand=AMD");
    expect(res.status).toBe(400);
  });

  it("caps pageSize at 50", async () => {
    expect((await request(buildApp()).get("/api/v1/products?pageSize=51")).status).toBe(400);
  });

  it("uses the rated repository for rating sort and rejects unsupported sort values", async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      { id: 1, averageRating: 4.6, totalReviews: BigInt(3), total: BigInt(1) },
    ]);
    prismaMock.product.findMany.mockResolvedValue([product]);
    const res = await request(buildApp()).get("/api/v1/products?sort=rating_desc");
    expect(res.status).toBe(200);
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(res.body.data[0].reviewSummary).toEqual({ averageRating: 4.6, totalReviews: 3 });

    const invalid = await request(buildApp()).get("/api/v1/products?sort=name_asc");
    expect(invalid.status).toBe(400);
  });
});

describe("GET /api/v1/products/:id", () => {
  it("returns the product", async () => {
    prismaMock.product.findUnique.mockResolvedValue(product);
    const res = await request(buildApp()).get("/api/v1/products/1");
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Asus");
  });

  it("returns 404 for a hidden product", async () => {
    prismaMock.product.findUnique.mockResolvedValue({ ...product, isActive: false });
    const res = await request(buildApp()).get("/api/v1/products/1");
    expect(res.status).toBe(404);
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
    expect(
      res.body.data.facetDefinitions.map((definition: { key: string }) => definition.key),
    ).toEqual(
      expect.arrayContaining(["cpuBrand", "gpuBrand", "gpuType", "ramGb", "panelType", "inStock"]),
    );
  });
});

describe("GET /api/v1/products/facets", () => {
  it("returns dynamic counts with the parsed filter query", async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      { facetKey: "__total__", value: "__total__", count: BigInt(2) },
      { facetKey: "cpuBrand", value: "INTEL", count: BigInt(2) },
    ]);
    const res = await request(buildApp()).get("/api/v1/products/facets?cpuBrand=INTEL&ramGb=16");
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.groups.cpuBrand).toEqual(
      expect.arrayContaining([{ value: "INTEL", count: 2 }]),
    );
  });

  it("rejects an unknown facet value", async () => {
    const res = await request(buildApp()).get("/api/v1/products/facets?cpuBrand=UNKNOWN");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/products/compare", () => {
  it("returns active products in the requested order", async () => {
    prismaMock.product.findMany.mockResolvedValue([
      { ...product, id: 2 },
      { ...product, id: 7 },
      { ...product, id: 1 },
    ]);
    const res = await request(buildApp()).get("/api/v1/products/compare?ids=7,1,2");
    expect(res.status).toBe(200);
    expect(res.body.data.map((p: { id: number }) => p.id)).toEqual([7, 1, 2]);
    expect(res.body.data[0].image).toBe("/images/product/a.png");
    expect(prismaMock.product.findMany).toHaveBeenCalledWith({
      where: { id: { in: [7, 1, 2] }, isActive: true },
    });
  });

  it("accepts spaces around ids", async () => {
    prismaMock.product.findMany.mockResolvedValue([product, { ...product, id: 2 }]);
    const res = await request(buildApp()).get("/api/v1/products/compare?ids=1,%202");
    expect(res.status).toBe(200);
  });

  it("returns 404 listing the missing or hidden ids", async () => {
    prismaMock.product.findMany.mockResolvedValue([product]);
    const res = await request(buildApp()).get("/api/v1/products/compare?ids=1,3,9");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: "NOT_FOUND", details: { missingIds: [3, 9] } });
  });

  it.each([
    ["no ids", ""],
    ["one id", "?ids=1"],
    ["five ids", "?ids=1,2,3,4,5"],
    ["duplicate ids", "?ids=1,1"],
    ["a non-numeric id", "?ids=1,abc"],
    ["a zero id", "?ids=0,1"],
    ["an empty id", "?ids=1,,2"],
    ["a repeated ids param", "?ids=1&ids=2"],
  ])("returns 400 for %s", async (_name, qs) => {
    const res = await request(buildApp()).get(`/api/v1/products/compare${qs}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(prismaMock.product.findMany).not.toHaveBeenCalled();
  });
});
