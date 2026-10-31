import {
  claimFlashSaleQuotas,
  releaseFlashSaleAllocations,
  recordFlashSaleAllocations,
} from "modules/promotions/flash-sale-quota";

const now = new Date("2026-10-22T00:00:00.000Z");

const txMock = () => ({
  $queryRaw: jest.fn().mockResolvedValue([
    {
      id: 1,
      state: "ACTIVE",
      startsAt: new Date("2026-10-01"),
      endsAt: new Date("2099-01-01"),
      pricingVersion: 1,
    },
    {
      id: 2,
      state: "ACTIVE",
      startsAt: new Date("2026-10-01"),
      endsAt: new Date("2099-01-01"),
      pricingVersion: 1,
    },
  ]),
  flashSaleProductQuota: {
    findUnique: jest
      .fn()
      .mockResolvedValue({ totalQuota: 10, claimedUnits: 0, maxUnitsPerUser: 2 }),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  flashSaleUserUsage: {
    upsert: jest.fn().mockResolvedValue({ claimedUnits: 0 }),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    findUnique: jest.fn().mockResolvedValue({ claimedUnits: 2 }),
  },
  flashSaleAllocation: {
    create: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
});

describe("flash sale quota service", () => {
  it.each([
    [
      "state",
      {
        id: 1,
        state: "PAUSED",
        startsAt: new Date("2026-10-01"),
        endsAt: new Date("2099-01-01"),
        pricingVersion: 1,
      },
    ],
    [
      "time window",
      {
        id: 1,
        state: "ACTIVE",
        startsAt: new Date("2026-10-23"),
        endsAt: new Date("2099-01-01"),
        pricingVersion: 1,
      },
    ],
    [
      "pricing version",
      {
        id: 1,
        state: "ACTIVE",
        startsAt: new Date("2026-10-01"),
        endsAt: new Date("2099-01-01"),
        pricingVersion: 2,
      },
    ],
  ])("normalizes a locked promotion %s change to PROMOTION_CHANGED", async (_field, row) => {
    const tx = txMock();
    jest.useFakeTimers().setSystemTime(now);
    try {
      tx.$queryRaw.mockResolvedValueOnce([row]);

      await expect(
        claimFlashSaleQuotas(tx as never, {
          userId: 7,
          now,
          claims: [{ promotionId: 1, productId: 3, quantity: 1, pricingVersion: 1 }],
        }),
      ).rejects.toMatchObject({
        code: "PROMOTION_CHANGED",
        details: { promotionId: 1 },
      });
      expect(tx.flashSaleProductQuota.findUnique).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("validates the campaign time after waiting for its row lock", async () => {
    const beforeLock = new Date("2026-10-22T00:00:00.000Z");
    const afterLock = new Date("2026-10-22T00:00:02.000Z");
    const tx = txMock();
    jest.useFakeTimers().setSystemTime(beforeLock);
    try {
      tx.$queryRaw.mockImplementationOnce(async () => {
        jest.setSystemTime(afterLock);
        return [
          {
            id: 1,
            state: "ACTIVE",
            startsAt: new Date("2026-10-21T00:00:00.000Z"),
            endsAt: new Date("2026-10-22T00:00:01.000Z"),
            pricingVersion: 1,
          },
        ];
      });

      await expect(
        claimFlashSaleQuotas(tx as never, {
          userId: 7,
          now: beforeLock,
          claims: [{ promotionId: 1, productId: 3, quantity: 1, pricingVersion: 1 }],
        }),
      ).rejects.toMatchObject({ code: "PROMOTION_CHANGED", details: { promotionId: 1 } });
      expect(tx.flashSaleProductQuota.findUnique).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("locks promotions, quotas and user usages in deterministic tuple order", async () => {
    const tx = txMock();
    await claimFlashSaleQuotas(tx as never, {
      userId: 7,
      now,
      claims: [
        { promotionId: 2, productId: 4, quantity: 1, pricingVersion: 1 },
        { promotionId: 1, productId: 9, quantity: 1, pricingVersion: 1 },
        { promotionId: 1, productId: 3, quantity: 1, pricingVersion: 1 },
      ],
    });

    expect(tx.$queryRaw.mock.invocationCallOrder.length).toBe(1);
    expect(tx.flashSaleProductQuota.findUnique.mock.invocationCallOrder[0]).toBeLessThan(
      tx.flashSaleProductQuota.updateMany.mock.invocationCallOrder[0],
    );
    expect(tx.flashSaleUserUsage.upsert).toHaveBeenCalledTimes(3);
  });

  it("returns a stable global quota conflict with safe details", async () => {
    const tx = txMock();
    tx.flashSaleProductQuota.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      claimFlashSaleQuotas(tx as never, {
        userId: 7,
        now,
        claims: [{ promotionId: 1, productId: 3, quantity: 2, pricingVersion: 1 }],
      }),
    ).rejects.toMatchObject({
      code: "FLASH_SALE_QUOTA_EXCEEDED",
      details: { promotionId: 1, productId: 3, requestedQuantity: 2 },
    });
    expect(tx.flashSaleUserUsage.upsert).not.toHaveBeenCalled();
  });

  it("does not decrement counters when the allocation transition loses the race", async () => {
    const tx = txMock();
    tx.flashSaleAllocation.findMany.mockResolvedValue([
      { id: 1, promotionId: 1, productId: 3, userId: 7, quantity: 2, status: "CLAIMED" },
    ]);
    tx.flashSaleAllocation.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      releaseFlashSaleAllocations(tx as never, { orderId: 5, reason: "CANCELLED", now }),
    ).resolves.toBe(0);
    expect(tx.flashSaleProductQuota.updateMany).not.toHaveBeenCalled();
    expect(tx.flashSaleUserUsage.updateMany).not.toHaveBeenCalled();
  });

  it("rejects release when the global quota decrement does not update one row", async () => {
    const tx = txMock();
    tx.flashSaleAllocation.findMany.mockResolvedValue([
      { id: 1, promotionId: 1, productId: 3, userId: 7, quantity: 2, status: "CLAIMED" },
    ]);
    tx.flashSaleAllocation.updateMany.mockResolvedValueOnce({ count: 1 });
    tx.flashSaleProductQuota.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      releaseFlashSaleAllocations(tx as never, { orderId: 5, reason: "CANCELLED", now }),
    ).rejects.toMatchObject({
      message: "Flash Sale quota counter mismatch",
      code: "FLASH_SALE_COUNTER_MISMATCH",
      details: { promotionId: 1, productId: 3, userId: 7, quantity: 2 },
    });
    expect(tx.flashSaleUserUsage.updateMany).not.toHaveBeenCalled();
  });

  it("rejects release when the user quota decrement does not update one row", async () => {
    const tx = txMock();
    tx.flashSaleAllocation.findMany.mockResolvedValue([
      { id: 1, promotionId: 1, productId: 3, userId: 7, quantity: 2, status: "CLAIMED" },
    ]);
    tx.flashSaleAllocation.updateMany.mockResolvedValueOnce({ count: 1 });
    tx.flashSaleProductQuota.updateMany.mockResolvedValueOnce({ count: 1 });
    tx.flashSaleUserUsage.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      releaseFlashSaleAllocations(tx as never, { orderId: 5, reason: "CANCELLED", now }),
    ).rejects.toMatchObject({
      code: "FLASH_SALE_COUNTER_MISMATCH",
      details: { promotionId: 1, productId: 3, userId: 7, quantity: 2 },
    });
  });

  it("increments released units only after both quota counters decrement", async () => {
    const tx = txMock();
    tx.flashSaleAllocation.findMany.mockResolvedValue([
      { id: 1, promotionId: 1, productId: 3, userId: 7, quantity: 2, status: "CLAIMED" },
    ]);
    tx.flashSaleAllocation.updateMany.mockResolvedValueOnce({ count: 1 });

    await expect(
      releaseFlashSaleAllocations(tx as never, { orderId: 5, reason: "CANCELLED", now }),
    ).resolves.toBe(2);
    expect(tx.flashSaleProductQuota.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.flashSaleUserUsage.updateMany).toHaveBeenCalledTimes(1);
  });

  it("loads claimed allocations in promotion, product and allocation order", async () => {
    const tx = txMock();
    tx.flashSaleAllocation.findMany.mockResolvedValue([]);

    await releaseFlashSaleAllocations(tx as never, { orderId: 5, reason: "CANCELLED", now });

    expect(tx.flashSaleAllocation.findMany).toHaveBeenCalledWith({
      where: { orderId: 5, status: "CLAIMED" },
      orderBy: [{ promotionId: "asc" }, { productId: "asc" }, { id: "asc" }],
    });
  });

  it("returns a stable per-user limit conflict after the global claim succeeds", async () => {
    const tx = txMock();
    tx.flashSaleUserUsage.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      claimFlashSaleQuotas(tx as never, {
        userId: 7,
        now,
        claims: [{ promotionId: 1, productId: 3, quantity: 1, pricingVersion: 1 }],
      }),
    ).rejects.toMatchObject({
      code: "FLASH_SALE_USER_LIMIT",
      details: { promotionId: 1, productId: 3, requestedQuantity: 1, userRemainingQuota: 0 },
    });
  });

  it("writes allocation history in sorted line order", async () => {
    const tx = txMock();
    await recordFlashSaleAllocations(tx as never, {
      userId: 7,
      orderId: 5,
      lines: [
        { orderDetailId: 20, promotionId: 2, productId: 4, quantity: 1, discountAmount: 10 },
        { orderDetailId: 10, promotionId: 1, productId: 3, quantity: 1, discountAmount: 20 },
      ],
    });
    expect(
      tx.flashSaleAllocation.create.mock.calls.map(
        ([call]: [{ data: { orderDetailId: number } }]) => call.data.orderDetailId,
      ),
    ).toEqual([10, 20]);
  });
});
