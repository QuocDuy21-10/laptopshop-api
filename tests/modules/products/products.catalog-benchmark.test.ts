import { describe, expect, it } from "@jest/globals";
import {
  assertBenchmarkDatabase,
  parseCatalogBenchmarkArgs,
} from "../../benchmarks/catalog-hardening";

describe("catalog benchmark arguments", () => {
  it("accepts only supported sizes and modes", () => {
    expect(parseCatalogBenchmarkArgs(["--size=10000", "--mode=baseline", "--run"])).toEqual({
      size: 10_000,
      mode: "baseline",
      run: true,
    });
    expect(parseCatalogBenchmarkArgs(["--size=50000", "--mode=hardened"])).toEqual({
      size: 50_000,
      mode: "hardened",
      run: false,
    });
    expect(() => parseCatalogBenchmarkArgs(["--size=1000", "--mode=baseline"])).toThrow(
      "size must be 10000 or 50000",
    );
    expect(() => parseCatalogBenchmarkArgs(["--size=10000", "--mode=other"])).toThrow(
      "mode must be baseline or hardened",
    );
  });

  it("rejects a non-test database before any connection is attempted", () => {
    expect(() => assertBenchmarkDatabase("mysql://root:test@127.0.0.1:3306/laptopshop")).toThrow(
      "database name must end in _test",
    );
    expect(() =>
      assertBenchmarkDatabase("mysql://root:test@127.0.0.1:3307/laptopshop_test"),
    ).not.toThrow();
  });
});
