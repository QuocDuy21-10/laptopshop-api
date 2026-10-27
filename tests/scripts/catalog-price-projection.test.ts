jest.mock("config/client", () => ({ prisma: require("../helpers/prisma").prismaMock }));

import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { parseCatalogProjectionCommand } from "scripts/rebuild-catalog-price-windows";
import { runCatalogPriceProjectionAudit } from "scripts/audit-catalog-price-windows";
import { prismaMock, resetPrisma } from "../helpers/prisma";

describe("catalog price projection commands", () => {
  it("defaults rebuild to dry-run and requires an explicit apply flag", () => {
    expect(parseCatalogProjectionCommand([])).toEqual({ apply: false });
    expect(parseCatalogProjectionCommand(["--apply"])).toEqual({ apply: true });
  });
});

describe("catalog price projection audit command", () => {
  beforeEach(() => resetPrisma());
  afterEach(() => {
    process.exitCode = undefined;
  });

  it("fails the process when the projection has issues", async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      { productId: 1, activeWindows: 0, staleWindows: 0, listPriceMismatches: 0 },
    ]);
    const result = await runCatalogPriceProjectionAudit(new Date());
    expect(result.issues).toHaveLength(1);
    expect(process.exitCode).toBe(1);
  });

  it("leaves the exit code alone when the projection is healthy", async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      { productId: 1, activeWindows: 1, staleWindows: 0, listPriceMismatches: 0 },
    ]);
    await runCatalogPriceProjectionAudit(new Date());
    expect(process.exitCode).toBeUndefined();
  });
});
