import { canTransition } from "modules/orders/order-status";

describe("canTransition", () => {
  it.each([
    ["PENDING", "SHIPPING", true],
    ["PENDING", "CANCELLED", true],
    ["PENDING", "COMPLETED", false],
    ["SHIPPING", "COMPLETED", true],
    ["SHIPPING", "CANCELLED", true],
    ["SHIPPING", "PENDING", false],
    ["COMPLETED", "CANCELLED", false],
    ["CANCELLED", "PENDING", false],
    ["UNKNOWN", "SHIPPING", false],
  ] as const)("%s -> %s is %s", (from, to, expected) => {
    expect(canTransition(from, to)).toBe(expected);
  });
});
