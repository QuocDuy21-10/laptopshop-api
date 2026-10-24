import { AppError } from "lib/errors";
import {
  assertTransition,
  allowedAdminTransitionsFor,
  canTransition,
  type TransitionContext,
} from "modules/after-sales/after-sales.status";

const context: TransitionContext = { now: new Date("2026-10-23T00:00:00.000Z") };

describe("after-sales item transitions", () => {
  it("does not offer quotes for warranty items", () => {
    expect(canTransition("WARRANTY", "DIAGNOSING", "AWAITING_QUOTE_DECISION", context)).toBe(false);
  });

  it("requires an accepted quote before paid technical work starts", () => {
    expect(
      canTransition("TECHNICAL_SUPPORT", "AWAITING_QUOTE_DECISION", "IN_SERVICE", {
        ...context,
        quoteAccepted: true,
      }),
    ).toBe(true);
    expect(
      canTransition("TECHNICAL_SUPPORT", "AWAITING_QUOTE_DECISION", "IN_SERVICE", context),
    ).toBe(false);
  });

  it("keeps technical support remote-only after quote acceptance", () => {
    const quoteAccepted = { ...context, quoteAccepted: true };
    expect(canTransition("TECHNICAL_SUPPORT", "APPROVED", "AWAITING_ITEM", quoteAccepted)).toBe(
      false,
    );
    expect(
      canTransition("TECHNICAL_SUPPORT", "AWAITING_QUOTE_DECISION", "AWAITING_ITEM", quoteAccepted),
    ).toBe(false);
    expect(
      allowedAdminTransitionsFor("TECHNICAL_SUPPORT", "AWAITING_QUOTE_DECISION", quoteAccepted),
    ).toEqual(["DIAGNOSING", "IN_SERVICE"]);
  });

  it("allows customer cancellation only before the device is received", () => {
    expect(canTransition("WARRANTY", "AWAITING_ITEM", "CANCELLED", context)).toBe(true);
    expect(canTransition("WARRANTY", "RECEIVED", "CANCELLED", context)).toBe(false);
  });

  it("requires the confirmation deadline before administrative close", () => {
    const dueAt = new Date("2026-10-24T00:00:00.000Z");
    expect(
      canTransition("TECHNICAL_SUPPORT", "RETURNED", "CLOSED", {
        ...context,
        now: new Date("2026-10-23T23:59:59.000Z"),
        confirmationDueAt: dueAt,
        closeMode: "ADMINISTRATIVE",
      }),
    ).toBe(false);
    expect(
      canTransition("TECHNICAL_SUPPORT", "RETURNED", "CLOSED", {
        ...context,
        now: new Date("2026-10-24T00:00:00.000Z"),
        confirmationDueAt: dueAt,
        closeMode: "ADMINISTRATIVE",
      }),
    ).toBe(true);
  });

  it("throws the stable transition error code", () => {
    expect(() =>
      assertTransition("WARRANTY", "DIAGNOSING", "AWAITING_QUOTE_DECISION", context),
    ).toThrow(
      new AppError("Invalid service request transition", 409, "INVALID_SERVICE_TRANSITION"),
    );
  });
});
