import { deriveRequestStatus } from "modules/after-sales/after-sales.aggregate";

describe("after-sales request aggregate status", () => {
  it("rejects an empty request", () => {
    expect(() => deriveRequestStatus([])).toThrow("A service request needs at least one item");
  });

  it("prioritizes partial completion over customer waiting", () => {
    expect(deriveRequestStatus(["CLOSED", "RETURNED"])).toBe("PARTIALLY_COMPLETED");
  });

  it("shows customer waiting when every active item waits for customer action", () => {
    expect(deriveRequestStatus(["RETURNED", "RESOLVED"])).toBe("AWAITING_CUSTOMER");
  });

  it("closes only when every item is terminal", () => {
    expect(deriveRequestStatus(["CLOSED", "REJECTED", "CANCELLED"])).toBe("CLOSED");
  });
});
