jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { listProductsQuery } from "modules/products/products.schema";
import { queryRatedProductPage } from "modules/products/products.rating.repository";

beforeEach(resetPrisma);

const query = (input: Record<string, unknown> = {}) => listProductsQuery.parse(input);

describe("rated catalog repository", () => {
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
    expect(statement.strings.join(" ")).toContain("p.id ASC");
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
    expect(statement.strings.join(" ")).toContain("p.price DESC");
    expect(statement.strings.join(" ")).not.toContain("name_asc");
  });
});
