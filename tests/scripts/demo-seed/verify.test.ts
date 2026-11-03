jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));
jest.mock("modules/inventory/inventory.reconciliation", () => ({
  findLedgerMismatches: jest.fn(),
}));
jest.mock("modules/promotions/flash-sale-verifier", () => ({ verifyFlashSaleCounters: jest.fn() }));
jest.mock("modules/pricing/catalog-price-projection.audit", () => ({
  auditCatalogPriceProjection: jest.fn(),
}));

import { verifyDemoData } from "scripts/demo-seed/verify";
import { findLedgerMismatches } from "modules/inventory/inventory.reconciliation";
import { verifyFlashSaleCounters } from "modules/promotions/flash-sale-verifier";
import { auditCatalogPriceProjection } from "modules/pricing/catalog-price-projection.audit";
import { prismaMock, resetPrisma } from "../../helpers/prisma";

const now = new Date("2026-11-02T03:00:00Z");

describe("verifyDemoData", () => {
  beforeEach(() => {
    resetPrisma();
    jest.mocked(findLedgerMismatches).mockResolvedValue([]);
    jest
      .mocked(verifyFlashSaleCounters)
      .mockResolvedValue({ valid: true, quotaMismatches: [], userMismatches: [] });
    jest.mocked(auditCatalogPriceProjection).mockResolvedValue({ checked: 50, issues: [] });
    prismaMock.$queryRaw.mockResolvedValue([]);
  });

  it("returns no issues when every check passes", async () => {
    await expect(verifyDemoData(now)).resolves.toEqual([]);
  });

  it("reports failing checks by name", async () => {
    jest
      .mocked(findLedgerMismatches)
      .mockResolvedValue([{ productId: 1, quantity: 5, ledgerQuantity: 4 }]);
    prismaMock.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 7 }]);
    const issues = await verifyDemoData(now);
    expect(issues.map((i) => i.check)).toEqual(["stock_ledger", "sold_mismatch"]);
    expect(issues[1].detail).toEqual([7]);
  });
});
