import { classifyCoverage, effectiveCoverage } from "modules/after-sales/after-sales.eligibility";

describe("after-sales eligibility", () => {
  const now = new Date("2026-10-23T00:00:00.000Z");

  it("classifies a zero-month product as having no warranty", () => {
    expect(classifyCoverage({ months: 0, startAt: null, endAt: null }, now)).toBe("NO_WARRANTY");
  });

  it("classifies an expired snapshot as out of warranty", () => {
    expect(
      classifyCoverage(
        {
          months: 24,
          startAt: new Date("2024-10-23T00:00:00.000Z"),
          endAt: new Date("2026-10-22T23:59:59.000Z"),
        },
        now,
      ),
    ).toBe("OUT_OF_WARRANTY");
  });

  it("requires verification when policy dates are incomplete", () => {
    expect(classifyCoverage({ months: 24, startAt: null, endAt: null }, now)).toBe(
      "REQUIRES_VERIFICATION",
    );
  });

  it("requires verification for a backfilled policy until an admin decision exists", () => {
    const backfill = {
      months: 24,
      startAt: new Date("2026-01-01T00:00:00.000Z"),
      endAt: new Date("2028-01-01T00:00:00.000Z"),
      policySource: "CURRENT_PRODUCT_POLICY_BACKFILL" as const,
    };
    expect(effectiveCoverage(backfill, null, now)).toBe("REQUIRES_VERIFICATION");
    expect(
      effectiveCoverage(
        backfill,
        {
          decision: "IN_WARRANTY",
          warrantyStartAt: backfill.startAt,
          warrantyEndAt: backfill.endAt,
        },
        now,
      ),
    ).toBe("IN_WARRANTY");
  });

  it("treats an IN_WARRANTY verification as expired once its end date has passed", () => {
    const unknown = {
      months: null,
      startAt: null,
      endAt: null,
      policySource: "UNAVAILABLE" as const,
    };
    const verification = {
      decision: "IN_WARRANTY" as const,
      warrantyStartAt: new Date("2025-01-01T00:00:00.000Z"),
      warrantyEndAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    expect(effectiveCoverage(unknown, verification, new Date("2026-01-01T00:00:00.000Z"))).toBe(
      "IN_WARRANTY",
    );
    expect(effectiveCoverage(unknown, verification, new Date("2026-01-02T00:00:00.000Z"))).toBe(
      "OUT_OF_WARRANTY",
    );
  });
});
