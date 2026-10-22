import { resolveAutomaticPromotions } from "modules/promotions/promotion-resolver";

const now = new Date("2026-10-22T00:00:00.000Z");

describe("automatic promotion resolver", () => {
  it("loads running targets in one batch and selects a deterministic winner", async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 20,
        name: "Lower priority larger discount",
        discountKind: "FIXED",
        discountValue: 500,
        pricingVersion: 1,
        startsAt: new Date("2026-10-01T00:00:00.000Z"),
        endsAt: new Date("2026-11-01T00:00:00.000Z"),
        automaticPolicy: { priority: 1, stackableWithCoupon: true },
        products: [
          { productId: 1, product: { price: 1_000 } },
          { productId: 2, product: { price: 1_000 } },
        ],
      },
      {
        id: 10,
        name: "Priority winner",
        discountKind: "PERCENT",
        discountValue: 10,
        pricingVersion: 2,
        startsAt: new Date("2026-10-01T00:00:00.000Z"),
        endsAt: new Date("2026-11-01T00:00:00.000Z"),
        automaticPolicy: { priority: 2, stackableWithCoupon: false },
        products: [
          { productId: 2, product: { price: 1_000 } },
          { productId: 1, product: { price: 1_000 } },
        ],
      },
    ]);
    const client = { promotion: { findMany } };

    const result = await resolveAutomaticPromotions(client, [2, 1], now);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: {
        kind: "AUTOMATIC",
        state: "ACTIVE",
        startsAt: { lte: now },
        endsAt: { gt: now },
        products: { some: { productId: { in: [1, 2] } } },
      },
    });
    expect(result.get(1)).toMatchObject({ id: 10, unitDiscount: 100, stackableWithCoupon: false });
    expect(result.get(2)).toMatchObject({ id: 10, unitDiscount: 100 });
  });

  it("returns no rows when there are no product IDs or no running targets", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const result = await resolveAutomaticPromotions({ promotion: { findMany } }, [], now);
    expect(result.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});
