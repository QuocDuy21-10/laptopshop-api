import {
  buildRuleBasedRecommendation,
  buildRuleBasedResult,
} from "modules/advisor/advisor.explanation";
import type { AdvisorInput, RankedAdvisorCandidate } from "modules/advisor/advisor.schema";

const input: AdvisorInput = {
  budgetMax: 20_000_000,
  usage: "CODING",
  priorities: ["PERFORMANCE"],
  minRamGb: 16,
  workloads: ["DOCKER_VM"],
};

const ranked = (over: Partial<RankedAdvisorCandidate> = {}): RankedAdvisorCandidate => ({
  product: {
    id: 1,
    name: "Laptop test",
    price: 18_000_000,
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
  },
  matchScore: 80,
  rawScore: 0.8,
  features: {
    cpu: 0.75,
    gpu: 0.75,
    ramStorage: 0.7,
    battery: 0.5,
    portability: 0.2,
    display: 0.8,
    value: 0.5,
  },
  evidence: [
    { key: "ram-16gb", text: "RAM 16 GB" },
    { key: "weight-2300g", text: "Trọng lượng 2300 g" },
    { key: "refresh-144hz", text: "Tần số quét 144 Hz" },
  ],
  ...over,
});

describe("rule-based advisor explanation", () => {
  it("uses at most three factual highlights and no unsupported performance claim", () => {
    const recommendation = buildRuleBasedRecommendation(ranked({ evidence: [] }), input);
    expect(recommendation.highlights.length).toBeLessThanOrEqual(3);
    expect(recommendation.reason).not.toMatch(/CPU mạnh|GPU phù hợp|pin lâu/i);
  });

  it("creates at most two tradeoffs and explains missing hardware safely", () => {
    const recommendation = buildRuleBasedRecommendation(
      ranked({ product: { ...ranked().product, cpu: null, gpu: null }, evidence: [] }),
      input,
    );
    expect(recommendation.tradeoffs.length).toBeLessThanOrEqual(2);
    expect(recommendation.tradeoffs.join(" ")).toMatch(/chưa có|thiếu|thông tin/i);
    expect(recommendation.tradeoffs.join(" ")).not.toMatch(/CPU mạnh|GPU phù hợp|pin lâu/i);
  });

  it("suggests relaxing hard constraints only when no candidate exists", () => {
    expect(buildRuleBasedResult([], input).suggestions).toEqual([
      "Thử tăng ngân sách hoặc giảm RAM tối thiểu để có thêm lựa chọn.",
    ]);
    expect(buildRuleBasedResult([ranked()], input).suggestions).toEqual([]);
  });
});
