import { lockProductRows } from "modules/orders/order-locks";

describe("order product locks", () => {
  it("locks unique product rows in ascending id order", async () => {
    const lockedRows = [
      { id: 2, price: 200, isActive: true, warrantyMonths: 12 },
      { id: 7, price: 700, isActive: false, warrantyMonths: null },
      { id: 9, price: 900, isActive: true, warrantyMonths: 24 },
    ];
    const tx = { $queryRaw: jest.fn().mockResolvedValue(lockedRows) };

    const result = await lockProductRows(tx as never, [9, 2, 7, 2]);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const [statement] = tx.$queryRaw.mock.calls[0];
    expect(statement.values).toEqual([2, 7, 9]);
    expect(statement.strings.join("?").replace(/\s+/g, " ").trim()).toBe(
      "SELECT id, price, isActive, warrantyMonths FROM products WHERE id IN (?,?,?) ORDER BY id ASC FOR UPDATE",
    );
    expect(result).toEqual(lockedRows);
  });

  it("does not issue a locking query for an empty product list", async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([]) };

    await expect(lockProductRows(tx as never, [])).resolves.toEqual([]);

    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});
