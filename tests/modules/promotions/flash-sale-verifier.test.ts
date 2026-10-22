import { verifyFlashSaleCounters } from "modules/promotions/flash-sale-verifier";

describe("verifyFlashSaleCounters", () => {
  it("passes when stored global and user counters match claimed allocations", async () => {
    const client = {
      flashSaleProductQuota: {
        findMany: jest.fn().mockResolvedValue([{ promotionId: 1, productId: 10, claimedUnits: 3 }]),
      },
      flashSaleAllocation: {
        groupBy: jest
          .fn()
          .mockResolvedValueOnce([{ promotionId: 1, productId: 10, _sum: { quantity: 3 } }])
          .mockResolvedValueOnce([
            { promotionId: 1, productId: 10, userId: 7, _sum: { quantity: 3 } },
          ]),
      },
      flashSaleUserUsage: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ promotionId: 1, productId: 10, userId: 7, claimedUnits: 3 }]),
      },
    };

    await expect(verifyFlashSaleCounters(client as never)).resolves.toEqual({
      valid: true,
      quotaMismatches: [],
      userMismatches: [],
    });
  });

  it("reports global and user counter drift", async () => {
    const client = {
      flashSaleProductQuota: {
        findMany: jest.fn().mockResolvedValue([{ promotionId: 1, productId: 10, claimedUnits: 4 }]),
      },
      flashSaleAllocation: {
        groupBy: jest
          .fn()
          .mockResolvedValueOnce([{ promotionId: 1, productId: 10, _sum: { quantity: 3 } }])
          .mockResolvedValueOnce([
            { promotionId: 1, productId: 10, userId: 7, _sum: { quantity: 2 } },
          ]),
      },
      flashSaleUserUsage: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ promotionId: 1, productId: 10, userId: 7, claimedUnits: 1 }]),
      },
    };

    await expect(verifyFlashSaleCounters(client as never)).resolves.toEqual({
      valid: false,
      quotaMismatches: [{ promotionId: 1, productId: 10, stored: 4, expected: 3 }],
      userMismatches: [{ promotionId: 1, productId: 10, userId: 7, stored: 1, expected: 2 }],
    });
  });
});
