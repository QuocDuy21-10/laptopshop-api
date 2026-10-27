import { describe, expect, it } from "@jest/globals";
import {
  buildCatalogPriceTimeline,
  type CatalogPriceWindowDraft,
} from "modules/pricing/catalog-price-timeline";
import type { AutomaticPromotionCandidate } from "modules/promotions/automatic-promotion-policy";

const now = new Date("2026-10-27T00:00:00.000Z");
const candidate = (
  overrides: Partial<AutomaticPromotionCandidate> = {},
): AutomaticPromotionCandidate => ({
  id: 1,
  name: "Automatic",
  discountKind: "FIXED",
  discountValue: 1_000,
  priority: 1,
  stackableWithCoupon: false,
  pricingVersion: 1,
  startsAt: new Date("2026-10-28T00:00:00.000Z"),
  endsAt: new Date("2026-10-30T00:00:00.000Z"),
  ...overrides,
});

const expectContinuous = (windows: CatalogPriceWindowDraft[]) => {
  for (let index = 1; index < windows.length; index += 1) {
    expect(windows[index - 1].validUntil?.getTime()).toBe(windows[index].validFrom.getTime());
  }
};

describe("catalog price timeline", () => {
  it("returns one open-ended list-price window without promotions", () => {
    const windows = buildCatalogPriceTimeline({ listPrice: 10_000, candidates: [], now });
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      validFrom: now,
      validUntil: null,
      source: "LIST_PRICE",
      effectiveCatalogPrice: 10_000,
      automaticPromotionId: null,
    });
  });

  it("creates list, automatic, and list windows around one future promotion", () => {
    const windows = buildCatalogPriceTimeline({
      listPrice: 10_000,
      candidates: [candidate()],
      now,
    });
    expect(
      windows.map(({ source, effectiveCatalogPrice }) => ({ source, effectiveCatalogPrice })),
    ).toEqual([
      { source: "LIST_PRICE", effectiveCatalogPrice: 10_000 },
      { source: "AUTOMATIC", effectiveCatalogPrice: 9_000 },
      { source: "LIST_PRICE", effectiveCatalogPrice: 10_000 },
    ]);
    expectContinuous(windows);
  });

  it("changes the winner at every overlapping promotion boundary", () => {
    const windows = buildCatalogPriceTimeline({
      listPrice: 10_000,
      candidates: [
        candidate({
          id: 1,
          discountValue: 1_000,
          startsAt: new Date("2026-10-28"),
          endsAt: new Date("2026-11-02"),
        }),
        candidate({
          id: 2,
          priority: 2,
          discountValue: 2_000,
          startsAt: new Date("2026-10-29"),
          endsAt: new Date("2026-10-31"),
        }),
      ],
      now,
    });
    expect(
      windows.map(({ source, effectiveCatalogPrice, automaticPromotionId }) => ({
        source,
        effectiveCatalogPrice,
        automaticPromotionId,
      })),
    ).toEqual([
      { source: "LIST_PRICE", effectiveCatalogPrice: 10_000, automaticPromotionId: null },
      { source: "AUTOMATIC", effectiveCatalogPrice: 9_000, automaticPromotionId: 1 },
      { source: "AUTOMATIC", effectiveCatalogPrice: 8_000, automaticPromotionId: 2 },
      { source: "AUTOMATIC", effectiveCatalogPrice: 9_000, automaticPromotionId: 1 },
      { source: "LIST_PRICE", effectiveCatalogPrice: 10_000, automaticPromotionId: null },
    ]);
    expectContinuous(windows);
  });

  it("merges a boundary that does not change the winning price", () => {
    const windows = buildCatalogPriceTimeline({
      listPrice: 10_000,
      candidates: [
        candidate({
          id: 1,
          priority: 2,
          startsAt: new Date("2026-10-27"),
          endsAt: new Date("2026-11-02"),
        }),
        candidate({
          id: 2,
          priority: 1,
          discountValue: 500,
          startsAt: new Date("2026-10-28"),
          endsAt: new Date("2026-10-29"),
        }),
      ],
      now,
    });
    expect(windows).toHaveLength(2);
    expectContinuous(windows);
  });
});
