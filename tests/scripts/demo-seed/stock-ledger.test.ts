import { createStockLedger } from "scripts/demo-seed/stock-ledger";

const at = new Date("2026-01-01T00:00:00Z");

describe("createStockLedger", () => {
  it("chains balances and tracks sold like moveStock", () => {
    const ledger = createStockLedger([{ productId: 1, quantity: 10, at }]);
    ledger.move({ productId: 1, delta: -3, reason: "ORDER", at, orderId: 1 });
    ledger.move({ productId: 1, delta: 1, reason: "ORDER_CANCEL", at, orderId: 1 });
    ledger.move({ productId: 1, delta: 5, reason: "RESTOCK", at, receiptId: "r1" });
    expect(ledger.balance(1)).toBe(13);
    expect(ledger.sold(1)).toBe(2);
    expect(ledger.movements.map((m) => [m.balanceBefore, m.balanceAfter])).toEqual([
      [0, 10],
      [10, 7],
      [7, 8],
      [8, 13],
    ]);
    expect(ledger.movements[0].reason).toBe("OPENING");
  });

  it("refuses to go below zero", () => {
    const ledger = createStockLedger([{ productId: 1, quantity: 1, at }]);
    expect(() => ledger.move({ productId: 1, delta: -2, reason: "ORDER", at })).toThrow(/negative/);
  });
});
