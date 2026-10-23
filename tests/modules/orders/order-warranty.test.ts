import {
  addCalendarMonthsClamped,
  warrantySnapshotForCompletion,
} from "modules/orders/order-warranty";

describe("order warranty snapshot", () => {
  it("clamps Jan 31 plus one month to the last day of February", () => {
    expect(addCalendarMonthsClamped(new Date("2028-01-31T03:00:00.000Z"), 1).toISOString()).toBe(
      "2028-02-29T03:00:00.000Z",
    );
  });

  it("returns start and end dates for a configured warranty", () => {
    const completedAt = new Date("2026-10-23T03:00:00.000Z");

    expect(warrantySnapshotForCompletion({ months: 24, completedAt })).toEqual({
      startAt: completedAt,
      endAt: new Date("2028-10-23T03:00:00.000Z"),
    });
  });

  it("keeps missing warranty policy unresolved", () => {
    const completedAt = new Date("2026-10-23T03:00:00.000Z");

    expect(warrantySnapshotForCompletion({ months: null, completedAt })).toEqual({
      startAt: null,
      endAt: null,
    });
  });
});
