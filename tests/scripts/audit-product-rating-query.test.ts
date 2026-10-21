import { describe, expect, it } from "@jest/globals";
import {
  assertSafeDatabaseTarget,
  buildRatingAuditQuery,
  summarizeExplainRows,
} from "scripts/audit-product-rating-query";

describe("product rating query audit", () => {
  it("builds a read-only EXPLAIN for the combined rating filter and sort", () => {
    const query = buildRatingAuditQuery();
    expect(query.strings.join(" ")).toContain("EXPLAIN");
    expect(query.strings.join(" ")).toContain("minRating");
    expect(query.strings.join(" ")).toContain("averageRating DESC");
    expect(query.values).toEqual(expect.arrayContaining([4]));
  });

  it("rejects non-test targets unless explicitly approved", () => {
    expect(() => assertSafeDatabaseTarget("mysql://db/catalog")).toThrow(/test/i);
    expect(() =>
      assertSafeDatabaseTarget("mysql://db/catalog", "mysql://db/catalog"),
    ).not.toThrow();
    expect(() => assertSafeDatabaseTarget("mysql://db/catalog_test")).not.toThrow();
  });

  it("reports full scans, temporary tables and filesorts without mutation", () => {
    expect(
      summarizeExplainRows([
        { plan: { access_type: "ALL", using_temporary_table: true, using_filesort: true } },
      ]),
    ).toEqual({ fullScan: true, temporaryTable: true, filesort: true });
  });
});
