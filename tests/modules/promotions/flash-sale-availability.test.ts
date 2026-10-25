jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { getFlashSaleAvailability } from "modules/promotions/flash-sale-availability";

const now = new Date("2026-10-22T00:00:00.000Z");

beforeEach(resetPrisma);

const flashRow = (overrides: Record<string, unknown> = {}) => ({
  id: 42,
  name: "Flash Sale",
  startsAt: new Date("2026-10-22T01:00:00.000Z"),
  endsAt: new Date("2026-10-23T00:00:00.000Z"),
  state: "ACTIVE",
  flashSalePolicy: {
    priority: 10,
    showRemainingQuota: false,
    quotas: [
      {
        productId: 1,
        totalQuota: 10,
        claimedUnits: 4,
        maxUnitsPerUser: 2,
        product: { id: 1, name: "Laptop", image: null, price: 1_000 },
        usages: [{ userId: 7, claimedUnits: 1 }],
      },
    ],
  },
  ...overrides,
});

describe("getFlashSaleAvailability", () => {
  it("rejects empty, duplicate and oversized product batches", async () => {
    await expect(getFlashSaleAvailability({ productIds: [], now })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(getFlashSaleAvailability({ productIds: [1, 1], now })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(
      getFlashSaleAvailability({
        productIds: Array.from({ length: 21 }, (_, index) => index + 1),
        now,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("returns scheduled/running winners without private usage data for anonymous users", async () => {
    prismaMock.promotion.findMany.mockResolvedValue([
      flashRow(),
      flashRow({
        id: 11,
        startsAt: new Date("2026-10-21T00:00:00.000Z"),
        flashSalePolicy: {
          priority: 20,
          showRemainingQuota: true,
          quotas: [
            {
              productId: 1,
              totalQuota: 5,
              claimedUnits: 2,
              maxUnitsPerUser: 1,
              product: { id: 1, name: "Laptop", image: null },
              usages: [],
            },
          ],
        },
      }),
    ]);

    const result = await getFlashSaleAvailability({ productIds: [1], now });

    expect(result.serverTime).toBe(now);
    expect(result.items).toEqual([
      expect.objectContaining({
        productId: 1,
        promotionId: 11,
        state: "RUNNING",
        remainingQuota: 3,
        available: true,
      }),
    ]);
    expect(result.items[0]).not.toHaveProperty("userRemainingQuota");
  });

  it("returns authenticated user remaining quota", async () => {
    prismaMock.promotion.findMany.mockResolvedValue([
      flashRow({ startsAt: new Date("2026-10-21T00:00:00.000Z") }),
    ]);

    const result = await getFlashSaleAvailability({ productIds: [1], userId: 7, now });

    expect(result.items[0]).toMatchObject({
      remainingQuota: null,
      available: true,
      userRemainingQuota: 1,
    });
  });

  it("prefers a running Flash Sale over a higher-priority scheduled campaign", async () => {
    prismaMock.promotion.findMany.mockResolvedValue([
      flashRow({
        id: 100,
        flashSalePolicy: { ...flashRow().flashSalePolicy, priority: 100 },
      }),
      flashRow({
        id: 1,
        startsAt: new Date("2026-10-21T00:00:00.000Z"),
        flashSalePolicy: { ...flashRow().flashSalePolicy, priority: 1 },
      }),
    ]);

    const result = await getFlashSaleAvailability({ productIds: [1], now });

    expect(result.items).toEqual([
      expect.objectContaining({ promotionId: 1, state: "RUNNING", available: true }),
    ]);
  });

  it("treats the start boundary as running and excludes the end boundary", async () => {
    prismaMock.promotion.findMany.mockResolvedValue([
      flashRow({ id: 100, startsAt: now, endsAt: new Date("2026-10-23T00:00:00.000Z") }),
      flashRow({
        id: 1,
        startsAt: new Date("2026-10-21T00:00:00.000Z"),
        endsAt: now,
        flashSalePolicy: { ...flashRow().flashSalePolicy, priority: 999 },
      }),
    ]);

    const result = await getFlashSaleAvailability({ productIds: [1], now });

    expect(result.items).toEqual([expect.objectContaining({ promotionId: 100, state: "RUNNING" })]);
  });

  it("keeps the top exhausted running campaign visible instead of falling back to scheduled", async () => {
    prismaMock.promotion.findMany.mockResolvedValue([
      flashRow({
        id: 100,
        startsAt: new Date("2026-10-21T00:00:00.000Z"),
        flashSalePolicy: {
          ...flashRow().flashSalePolicy,
          priority: 1,
          quotas: [
            {
              ...flashRow().flashSalePolicy.quotas[0],
              claimedUnits: 10,
            },
          ],
        },
      }),
      flashRow({
        id: 1,
        flashSalePolicy: { ...flashRow().flashSalePolicy, priority: 100 },
      }),
    ]);

    const result = await getFlashSaleAvailability({ productIds: [1], now });

    expect(result.items).toEqual([
      expect.objectContaining({ promotionId: 100, state: "RUNNING", available: false }),
    ]);
  });

  it("selects a lower-ranked running campaign when the first has no quantity for one unit", async () => {
    prismaMock.promotion.findMany.mockResolvedValue([
      flashRow({
        id: 100,
        startsAt: new Date("2026-10-21T00:00:00.000Z"),
        flashSalePolicy: {
          ...flashRow().flashSalePolicy,
          priority: 100,
          quotas: [
            {
              ...flashRow().flashSalePolicy.quotas[0],
              claimedUnits: 10,
            },
          ],
        },
      }),
      flashRow({
        id: 1,
        startsAt: new Date("2026-10-21T00:00:00.000Z"),
        flashSalePolicy: { ...flashRow().flashSalePolicy, priority: 1 },
      }),
    ]);

    const result = await getFlashSaleAvailability({ productIds: [1], now });

    expect(result.items).toEqual([
      expect.objectContaining({ promotionId: 1, state: "RUNNING", available: true }),
    ]);
  });
});
