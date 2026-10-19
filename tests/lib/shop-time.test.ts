import { AppError } from "lib/errors";
import {
  assertDayRange,
  createdAtRange,
  dayEnd,
  dayStart,
  formatShopDateTime,
  toShopDay,
} from "lib/shop-time";

describe("shop time", () => {
  it("maps Vietnam calendar days to UTC instants", () => {
    expect(dayStart("2026-10-01")).toEqual(new Date("2026-09-30T17:00:00.000Z"));
    expect(dayEnd("2026-10-01")).toEqual(new Date("2026-10-01T17:00:00.000Z"));
  });

  it("formats an instant in Vietnam time", () => {
    expect(toShopDay(new Date("2026-10-01T17:30:00Z"))).toBe("2026-10-02");
    expect(formatShopDateTime(new Date("2026-10-01T17:30:00Z"))).toBe("2026-10-02 00:30");
  });

  it("builds an inclusive createdAt range", () => {
    expect(createdAtRange()).toEqual({});
    expect(createdAtRange("2026-10-01", "2026-10-19")).toEqual({
      createdAt: { gte: dayStart("2026-10-01"), lt: dayEnd("2026-10-19") },
    });
  });

  it("rejects reversed and too long ranges", () => {
    expect(() => assertDayRange("2026-10-19", "2026-10-01")).toThrow(AppError);
    expect(() => assertDayRange("2025-01-01", "2026-12-31", 366)).toThrow(/366/);
    expect(() => assertDayRange("2026-01-01", "2026-12-31", 366)).not.toThrow();
  });
});
