import { featureScoresFor, rankCandidates, weightsFor } from "modules/advisor/advisor.ranking";
import { hardwareTier } from "modules/advisor/advisor.hardware-profile";
import type { AdvisorCandidate, AdvisorInput } from "modules/advisor/advisor.schema";

const candidate = (over: Partial<AdvisorCandidate> = {}): AdvisorCandidate => ({
  id: 1,
  name: "Laptop test",
  price: 20_000_000,
  image: "test.png",
  detailDesc: "detail",
  shortDesc: "short",
  quantity: 5,
  sold: 0,
  factory: "ASUS",
  target: "GAMING",
  isActive: true,
  cpu: "Intel Core i5-11400H",
  gpu: "NVIDIA GeForce RTX 2050 4GB",
  ramGb: 16,
  storageGb: 512,
  screenSizeInch: 15.6,
  screenResolution: "1920x1080",
  refreshRateHz: 144,
  batteryWh: 48,
  weightGrams: 2300,
  warrantyMonths: 24,
  ...over,
});

const input: AdvisorInput = {
  budgetMax: 20_000_000,
  usage: "CODING",
  priorities: ["PERFORMANCE"],
  minRamGb: 16,
  workloads: ["DOCKER_VM"],
};

describe("hardwareTier", () => {
  it.each([
    ["cpu", "Intel Core i7-12700H", "high_end"],
    ["cpu", "Intel Core i5-11400H", "performance"],
    ["cpu", "Intel Core i7-1360P", "performance"],
    ["cpu", "Apple M2", "performance"],
    ["cpu", "Intel Core i5-13420H", "performance"],
    ["cpu", "Intel Core i5-1235U", "mainstream"],
    ["cpu", "Intel Core i5-10300H", "mainstream"],
    ["cpu", "Apple M1", "mainstream"],
    ["cpu", "Intel Core i5-1135G7", "mainstream"],
    ["cpu", "Intel Core i7-6500U", "entry"],
    ["gpu", "NVIDIA GeForce RTX 4050 6GB", "high_end"],
    ["gpu", "NVIDIA GeForce RTX 3050 4GB", "performance"],
    ["gpu", "NVIDIA GeForce RTX 2050 4GB", "performance"],
    ["gpu", "NVIDIA GeForce GTX 1650 4GB", "mainstream"],
    ["gpu", "Apple GPU 8 nhân", "mainstream"],
    ["gpu", "NVIDIA GeForce GTX 950M 4GB", "entry"],
    ["gpu", "Intel Iris Xe Graphics", "entry"],
    ["gpu", "Intel Iris Plus Graphics", "entry"],
    ["gpu", "Apple GPU 7 nhân", "entry"],
  ] as const)("maps %s %s to %s", (kind, value, expected) => {
    expect(hardwareTier(kind as "cpu" | "gpu", value)).toBe(expected);
  });

  it("returns unknown for missing or unrecognized hardware", () => {
    expect(hardwareTier("cpu", null)).toBe("unknown");
    expect(hardwareTier("gpu", "Custom silicon XYZ")).toBe("unknown");
  });
});

describe("advisor ranking", () => {
  it("uses the fixed normalization thresholds", () => {
    const scores = featureScoresFor(
      candidate({
        ramGb: 16,
        storageGb: 512,
        batteryWh: 48,
        weightGrams: 1500,
        screenResolution: "1920x1080",
        refreshRateHz: 144,
        warrantyMonths: 36,
        price: 10_000_000,
      }),
      { ...input, budgetMax: 20_000_000 },
    );
    expect(scores.ramStorage).toBeCloseTo((0.75 + 0.7) / 2);
    expect(scores.battery).toBe(0.5);
    expect(scores.portability).toBe(0.85);
    expect(scores.display).toBeCloseTo((0.6 + 1) / 2);
    expect(scores.value).toBeCloseTo(0.7 * 0.5 + 0.3 * 1);
  });

  it("applies modifiers and normalizes the weights", () => {
    const weights = weightsFor(input);
    expect(weights.cpu).toBeCloseTo(35 / 125);
    expect(weights.gpu).toBeCloseTo(10 / 125);
    expect(weights.ramStorage).toBeCloseTo(35 / 125);
    expect(Object.values(weights).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
  });

  it("sorts by score, then price, then id and returns at most three", () => {
    const ranked = rankCandidates(
      [
        candidate({ id: 3, price: 19_000_000, ramGb: 32 }),
        candidate({ id: 2, price: 18_000_000, ramGb: 32 }),
        candidate({ id: 1, price: 20_000_000, ramGb: 8 }),
        candidate({ id: 4, price: 17_000_000, ramGb: 8 }),
      ],
      { ...input, priorities: [] },
    );
    expect(ranked).toHaveLength(3);
    expect(ranked.map((item) => item.product.id)).toEqual([2, 3, 4]);
  });

  it("does not change existing scores when an unrelated candidate is added", () => {
    const base = rankCandidates(
      [candidate({ id: 1 }), candidate({ id: 2, price: 19_000_000 })],
      input,
    );
    const expanded = rankCandidates(
      [
        candidate({ id: 1 }),
        candidate({ id: 2, price: 19_000_000 }),
        candidate({
          id: 9,
          price: 20_000_000,
          cpu: "Intel Core i7-6500U",
          gpu: "NVIDIA GeForce GTX 950M 4GB",
          ramGb: 8,
          storageGb: 256,
          batteryWh: 40,
          weightGrams: 2500,
          refreshRateHz: 60,
        }),
      ],
      input,
    );
    expect(expanded.slice(0, 2).map((item) => [item.product.id, item.matchScore])).toEqual(
      base.map((item) => [item.product.id, item.matchScore]),
    );
  });

  it("ignores note changes and omits evidence for unknown hardware", () => {
    const first = rankCandidates([candidate({ cpu: null, gpu: "Unknown GPU" })], input)[0];
    const second = rankCandidates([candidate({ cpu: null, gpu: "Unknown GPU" })], {
      ...input,
      note: "gaming",
    })[0];
    expect(second.matchScore).toBe(first.matchScore);
    expect(first.evidence.some((e) => e.key.startsWith("cpu-") || e.key.startsWith("gpu-"))).toBe(
      false,
    );
    expect(first.features.cpu).toBe(0);
    expect(first.features.gpu).toBe(0);
  });
});
