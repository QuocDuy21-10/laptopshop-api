import { describe, expect, it } from "@jest/globals";
import { evaluatePriceAlert } from "modules/price-alerts/price-alert.policy";

describe("evaluatePriceAlert", () => {
  it("triggers percent mode at exactly five percent below the reference", () => {
    expect(
      evaluatePriceAlert({
        mode: "PERCENT_DROP",
        referencePrice: 10_000_000,
        targetPrice: null,
        currentPrice: 9_500_000,
      }),
    ).toEqual({ triggered: true, reason: "PERCENT_THRESHOLD_REACHED" });
  });

  it("does not trigger percent mode above the five-percent threshold", () => {
    expect(
      evaluatePriceAlert({
        mode: "PERCENT_DROP",
        referencePrice: 10_000_000,
        targetPrice: null,
        currentPrice: 9_500_001,
      }),
    ).toEqual({ triggered: false, reason: "THRESHOLD_NOT_REACHED" });
  });

  it("rejects a price that is equal to or above the reference", () => {
    expect(
      evaluatePriceAlert({
        mode: "PERCENT_DROP",
        referencePrice: 10_000_000,
        targetPrice: null,
        currentPrice: 10_000_000,
      }),
    ).toEqual({ triggered: false, reason: "PRICE_NOT_LOWER" });
    expect(
      evaluatePriceAlert({
        mode: "PERCENT_DROP",
        referencePrice: 10_000_000,
        targetPrice: null,
        currentPrice: 10_500_000,
      }),
    ).toEqual({ triggered: false, reason: "PRICE_NOT_LOWER" });
  });

  it("triggers target mode at exactly the target price", () => {
    expect(
      evaluatePriceAlert({
        mode: "TARGET_PRICE",
        referencePrice: 10_000_000,
        targetPrice: 9_000_000,
        currentPrice: 9_000_000,
      }),
    ).toEqual({ triggered: true, reason: "TARGET_REACHED" });
  });

  it("does not trigger target mode above the target price", () => {
    expect(
      evaluatePriceAlert({
        mode: "TARGET_PRICE",
        referencePrice: 10_000_000,
        targetPrice: 9_000_000,
        currentPrice: 9_000_001,
      }),
    ).toEqual({ triggered: false, reason: "THRESHOLD_NOT_REACHED" });
  });

  it.each([
    {
      mode: "PERCENT_DROP" as const,
      referencePrice: null,
      targetPrice: null,
      currentPrice: 9_000_000,
    },
    {
      mode: "PERCENT_DROP" as const,
      referencePrice: 10_000_000,
      targetPrice: 9_000_000,
      currentPrice: 9_000_000,
    },
    {
      mode: "TARGET_PRICE" as const,
      referencePrice: null,
      targetPrice: 9_000_000,
      currentPrice: 8_000_000,
    },
    {
      mode: "TARGET_PRICE" as const,
      referencePrice: 10_000_000,
      targetPrice: null,
      currentPrice: 8_000_000,
    },
    {
      mode: "TARGET_PRICE" as const,
      referencePrice: 10_000_000,
      targetPrice: 0,
      currentPrice: 8_000_000,
    },
    {
      mode: "PERCENT_DROP" as const,
      referencePrice: 10_000_000,
      targetPrice: null,
      currentPrice: 0,
    },
  ])("returns INVALID_STATE for malformed input %#", (input) => {
    expect(evaluatePriceAlert(input)).toEqual({ triggered: false, reason: "INVALID_STATE" });
  });
});
