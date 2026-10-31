jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import { describe, expect, it } from "@jest/globals";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { queryProductFacetRows } from "modules/products/products.facets.repository";
import { productFacetsQuery } from "modules/products/products.schema";

beforeEach(resetPrisma);

describe("product facet repository", () => {
  it("counts products without an active window at their list price", async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);
    await queryProductFacetRows(productFacetsQuery.parse({}), {
      asOf: new Date(),
      mode: "PROJECTED",
    });
    const sql = (prismaMock.$queryRaw.mock.calls[0][0] as { strings: string[] }).strings.join(" ");
    expect(sql).toContain("LEFT JOIN (");
    expect(sql).toContain("COALESCE(cpw.effectiveCatalogPrice, p.price)");
    expect(sql).toContain("cpw.windowRank = 1");
    expect(sql).not.toContain("INNER JOIN catalog_price_windows");
  });
});
