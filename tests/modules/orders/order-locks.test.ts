import { lockProductRows } from "modules/orders/order-locks";

describe("order product locks", () => {
  it("locks unique product rows in ascending id order", async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([]) };

    await lockProductRows(tx as never, [9, 2, 7, 2]);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const [statement] = tx.$queryRaw.mock.calls[0];
    expect(statement.values).toEqual([2, 7, 9]);
    expect(statement.strings.join("?").replace(/\s+/g, " ").trim()).toBe(
      "SELECT id FROM products WHERE id IN (?,?,?) ORDER BY id ASC FOR UPDATE",
    );
  });

  it("does not issue a locking query for an empty product list", async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([]) };

    await lockProductRows(tx as never, []);

    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});
