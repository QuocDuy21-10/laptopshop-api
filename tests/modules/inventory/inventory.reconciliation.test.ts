jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { findLedgerMismatches } from "modules/inventory/inventory.reconciliation";

beforeEach(resetPrisma);

describe("findLedgerMismatches", () => {
  it("returns only products whose quantity differs from the ledger", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ productId: 3, quantity: 4, ledgerQuantity: 2 }]);
    await expect(findLedgerMismatches()).resolves.toEqual([
      { productId: 3, quantity: 4, ledgerQuantity: 2 },
    ]);
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("returns an empty list without mutating data when the ledger matches", async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);
    await expect(findLedgerMismatches()).resolves.toEqual([]);
    expect(prismaMock.product.update).not.toHaveBeenCalled();
    expect(prismaMock.stockMovement.create).not.toHaveBeenCalled();
  });
});
