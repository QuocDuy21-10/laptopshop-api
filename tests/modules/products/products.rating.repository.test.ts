jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { listProductsQuery } from "modules/products/products.schema";
import { queryRatedProductPage } from "modules/products/products.rating.repository";

beforeEach(resetPrisma);

const query = (input: Record<string, unknown> = {}) => listProductsQuery.parse(input);

describe("rated catalog repository", () => {
  it("restricts to running flash sales with quota and combines with sort and filters", async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);
    const now = new Date("2026-11-01T00:00:00.000Z");
    await queryRatedProductPage(
      query({ flashSale: "true", sort: "sold_desc", target: "GAMING" }),
      now,
    );
    const [statement] = prismaMock.$queryRaw.mock.calls[0];
    const sql = statement.strings.join(" ");
    expect(sql).toContain("flash_sale_product_quotas");
    expect(sql).toContain("q.productId = p.id");
    expect(sql).toContain("COALESCE(sold, 0) DESC");
    expect(statement.values).toEqual(
      expect.arrayContaining(["GAMING", "FLASH_SALE", "ACTIVE", now]),
    );
  });

  it("does not touch flash sale tables when flashSale is false", async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);
    await queryRatedProductPage(query({ flashSale: "false", sort: "rating_desc" }));
    const [statement] = prismaMock.$queryRaw.mock.calls[0];
    expect(statement.strings.join(" ")).not.toContain("flash_sale_product_quotas");
  });

  it("orders by units sold with null treated as zero", async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);
    await queryRatedProductPage(query({ minRating: "3", sort: "sold_desc" }));
    const [statement] = prismaMock.$queryRaw.mock.calls[0];
    const sql = statement.strings.join(" ");
    expect(sql).toContain("COALESCE(sold, 0) DESC, id ASC");
    expect(sql).toContain("p.sold");
  });

  it("binds user values and restores rating tie-breakers with nulls last", async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      { id: 2, averageRating: null, totalReviews: BigInt(0), total: BigInt(3) },
      { id: 4, averageRating: 4.5, totalReviews: BigInt(2), total: BigInt(3) },
    ]);

    const result = await queryRatedProductPage(
      query({ q: "O'Reilly", factory: "ASUS", minRating: "3", sort: "rating_desc" }),
    );
    const [statement] = prismaMock.$queryRaw.mock.calls[0];

    expect(statement.values).toEqual(expect.arrayContaining(["%O'Reilly%", "ASUS", 3, 0, 10]));
    expect(statement.values).not.toContain("rating_desc");
    expect(statement.strings.join(" ")).toContain("averageRating IS NULL ASC");
    expect(statement.strings.join(" ")).toContain("averageRating DESC");
    expect(statement.strings.join(" ")).toContain("totalReviews DESC");
    expect(statement.strings.join(" ")).toContain("id ASC");
    expect(result).toEqual({
      productIds: [2, 4],
      summaries: new Map([
        [2, { averageRating: null, totalReviews: 0 }],
        [4, { averageRating: 4.5, totalReviews: 2 }],
      ]),
      total: 3,
    });
  });

  it("uses the validated page offset and ignores arbitrary sort values", async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);
    await queryRatedProductPage(query({ page: 3, pageSize: 4, sort: "price_desc" }));
    const [statement] = prismaMock.$queryRaw.mock.calls[0];
    expect(statement.values).toEqual(expect.arrayContaining([8, 4]));
    expect(statement.strings.join(" ")).toContain("price DESC");
    expect(statement.strings.join(" ")).not.toContain("name_asc");
  });

  it("preserves the total when the requested page is beyond the last page", async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      { id: null, averageRating: null, totalReviews: BigInt(0), total: BigInt(3) },
    ]);

    await expect(
      queryRatedProductPage(query({ page: 99, pageSize: 10, sort: "rating_desc" })),
    ).resolves.toMatchObject({
      productIds: [],
      total: 3,
    });
  });
});
