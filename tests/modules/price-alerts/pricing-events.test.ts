import { requestPricingReevaluation } from "modules/price-alerts/pricing-events";

describe("requestPricingReevaluation", () => {
  it("writes a canonical pricing event without touching Redis", async () => {
    const create = jest.fn().mockResolvedValue({ id: 4 });
    const tx = { outboxEvent: { create } };

    await expect(
      requestPricingReevaluation(tx, {
        productIds: [3, 1, 3],
        eventVersion: "v2",
      }),
    ).resolves.toEqual({ id: 4 });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "PRICE_REEVALUATION_REQUESTED",
        aggregateType: "ProductPricing",
        aggregateId: 1,
        dedupeKey: expect.stringContaining("pricing-reevaluation-"),
        payload: { productIds: [1, 3], eventVersion: "v2", scopeHash: expect.any(String) },
      }),
    });
  });
});
