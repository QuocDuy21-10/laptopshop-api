import { classifyCoverage } from "modules/after-sales/after-sales.eligibility";

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
});
