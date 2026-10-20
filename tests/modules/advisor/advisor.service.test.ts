import { createAdvisorService } from "modules/advisor/advisor.service";
import { AdvisorProviderError } from "modules/advisor/providers/advisor-provider";
import type { AdvisorCandidate, AdvisorInput } from "modules/advisor/advisor.schema";

const input: AdvisorInput = {
  budgetMax: 20_000_000,
  usage: "CODING",
  priorities: [],
  workloads: [],
};

const product = (id: number): AdvisorCandidate => ({
  id,
  name: `Laptop ${id}`,
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
});

const repository = { findCandidates: jest.fn<Promise<AdvisorCandidate[]>, [AdvisorInput]>() };
const requester = { kind: "guest" as const, key: "guest-key" };

beforeEach(() => jest.clearAllMocks());

describe("createAdvisorService", () => {
  it("returns mapped rule-based recommendations when AI dependencies are absent", async () => {
    const raw = product(1);
    repository.findCandidates.mockResolvedValue([raw]);
    const result = await createAdvisorService({ repository }).recommend(input, requester);
    expect(result.mode).toBe("rule_based");
    expect(result.recommendations[0].product.image).toBe("/images/product/test.png");
    expect(result.recommendations[0].product).not.toBe(raw);
  });

  it.each([0, 1, 2])("returns exactly %s recommendations without filler", async (count) => {
    repository.findCandidates.mockResolvedValue(
      Array.from({ length: count }, (_, index) => product(index + 1)),
    );
    const result = await createAdvisorService({ repository }).recommend(input, requester);
    expect(result.recommendations).toHaveLength(count);
  });

  it("does not add products outside the repository result", async () => {
    repository.findCandidates.mockResolvedValue([product(1)]);
    const result = await createAdvisorService({ repository }).recommend(input, requester);
    expect(result.recommendations.map(({ product: item }) => item.id)).toEqual([1]);
  });

  it("uses a valid provider explanation without changing product order or score", async () => {
    repository.findCandidates.mockResolvedValue([product(1)]);
    const provider = {
      explain: jest.fn().mockResolvedValue({
        recommendations: [
          { productId: 1, reason: "Giải thích AI", evidenceKeys: ["ram-16gb"], tradeoffs: [] },
        ],
      }),
    };
    const quota = { tryReserve: jest.fn().mockResolvedValue(true) };
    const result = await createAdvisorService({ repository, provider, quota }).recommend(
      input,
      requester,
    );
    expect(result.mode).toBe("ai_enhanced");
    expect(result.recommendations[0]).toMatchObject({
      product: { id: 1 },
      matchScore: expect.any(Number),
      reason: "Giải thích AI",
    });
    expect(result.recommendations[0].highlights.length).toBeGreaterThan(0);
  });

  it("falls back as a whole when provider output is invalid", async () => {
    repository.findCandidates.mockResolvedValue([product(1)]);
    const provider = { explain: jest.fn().mockResolvedValue({ recommendations: [] }) };
    const quota = { tryReserve: jest.fn().mockResolvedValue(true) };
    const result = await createAdvisorService({ repository, provider, quota }).recommend(
      input,
      requester,
    );
    expect(result.mode).toBe("rule_based");
    expect(result.recommendations[0].reason).not.toBe("Giải thích AI");
  });

  it("does not call provider for an empty shortlist", async () => {
    repository.findCandidates.mockResolvedValue([]);
    const provider = { explain: jest.fn() };
    const quota = { tryReserve: jest.fn() };
    const result = await createAdvisorService({ repository, provider, quota }).recommend(
      input,
      requester,
    );
    expect(result.mode).toBe("rule_based");
    expect(provider.explain).not.toHaveBeenCalled();
    expect(quota.tryReserve).not.toHaveBeenCalled();
  });

  it("falls back when the requester quota is exhausted", async () => {
    repository.findCandidates.mockResolvedValue([product(1)]);
    const provider = { explain: jest.fn() };
    const quota = { tryReserve: jest.fn().mockResolvedValue(false) };
    const logger = { warn: jest.fn() };
    const result = await createAdvisorService({ repository, provider, quota, logger }).recommend(
      input,
      requester,
    );
    expect(result.mode).toBe("rule_based");
    expect(provider.explain).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith({ category: "quota" }, expect.any(String));
  });

  it("falls back on provider or Redis errors without logging note or requester key", async () => {
    repository.findCandidates.mockResolvedValue([product(1)]);
    const logger = { warn: jest.fn() };
    const provider = {
      explain: jest.fn().mockRejectedValue(new AdvisorProviderError("provider_429", "quota")),
    };
    const quota = { tryReserve: jest.fn().mockResolvedValue(true) };
    const result = await createAdvisorService({ repository, provider, quota, logger }).recommend(
      { ...input, note: "private note" },
      { kind: "guest", key: "private-key" },
    );
    expect(result.mode).toBe("rule_based");
    expect(logger.warn).toHaveBeenCalledWith({ category: "provider_429" }, expect.any(String));
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("private note");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("private-key");

    const redisLogger = { warn: jest.fn() };
    const redisResult = await createAdvisorService({
      repository,
      provider: { explain: jest.fn() },
      quota: { tryReserve: jest.fn().mockRejectedValue(new Error("redis down")) },
      logger: redisLogger,
    }).recommend(input, requester);
    expect(redisResult.mode).toBe("rule_based");
    expect(redisLogger.warn).toHaveBeenCalledWith({ category: "redis_error" }, expect.any(String));
  });

  it("logs safe completion telemetry without the requester or note", async () => {
    repository.findCandidates.mockResolvedValue([product(1)]);
    const info = jest.fn();
    const result = await createAdvisorService({
      repository,
      logger: { warn: jest.fn(), info },
      model: "model",
    }).recommend({ ...input, note: "private note" }, { kind: "guest", key: "private-key" });
    expect(result.mode).toBe("rule_based");
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "rule_based",
        model: "model",
        candidateCount: 1,
        latencyMs: expect.any(Number),
      }),
      "advisor completed",
    );
    expect(JSON.stringify(info.mock.calls)).not.toContain("private note");
    expect(JSON.stringify(info.mock.calls)).not.toContain("private-key");
  });
});
