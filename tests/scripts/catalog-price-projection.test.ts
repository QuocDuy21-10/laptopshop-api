import { describe, expect, it } from "@jest/globals";
import { parseCatalogProjectionCommand } from "scripts/rebuild-catalog-price-windows";

describe("catalog price projection commands", () => {
  it("defaults rebuild to dry-run and requires an explicit apply flag", () => {
    expect(parseCatalogProjectionCommand([])).toEqual({ apply: false });
    expect(parseCatalogProjectionCommand(["--apply"])).toEqual({ apply: true });
  });
});
