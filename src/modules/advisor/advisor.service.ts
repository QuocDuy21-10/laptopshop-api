import { buildRuleBasedResult } from "modules/advisor/advisor.explanation";
import { inspectAdvisorProviderInput } from "modules/advisor/advisor.input-guard";
import type { AdvisorAdmission } from "modules/advisor/advisor.admission";
import { priceAdvisorCandidates } from "modules/advisor/advisor.pricing";
import type { AdvisorRepository } from "modules/advisor/advisor.repository";
import { rankCandidates, selectTopAdvisorCandidates } from "modules/advisor/advisor.ranking";
import type {
  AdvisorCandidate,
  AdvisorInput,
  AdvisorMode,
  AdvisorRecommendation,
  AdvisorResult,
  PricedAdvisorCandidate,
  RankedAdvisorCandidate,
} from "modules/advisor/advisor.schema";
import {
  AdvisorProviderError,
  type AdvisorProvider,
  type ProviderExplanation,
} from "modules/advisor/providers/advisor-provider";

export type AdvisorRequester = { kind: "guest" | "user"; key: string };

export type AdvisorServiceDeps = {
  repository: AdvisorRepository;
  provider?: AdvisorProvider;
  admission?: AdvisorAdmission;
  logger?: {
    warn: (object: unknown, message?: string) => void;
    info?: (object: unknown, message?: string) => void;
  };
  model?: string;
  candidateBatchSize?: number;
  clock?: () => Date;
  priceCandidates?: (
    candidates: AdvisorCandidate[],
    now: Date,
  ) => Promise<PricedAdvisorCandidate[]>;
};

export type AdvisorService = {
  recommend(input: AdvisorInput, requester: AdvisorRequester): Promise<AdvisorResult>;
};

const providerMatchesRanking = (
  ranked: RankedAdvisorCandidate[],
  explanation: ProviderExplanation,
) =>
  explanation.recommendations.length === ranked.length &&
  explanation.recommendations.every((item, index) => item.productId === ranked[index].product.id);

const withProviderExplanation = (
  ranked: RankedAdvisorCandidate[],
  input: AdvisorInput,
  explanation: ProviderExplanation,
): AdvisorResult => {
  const byId = new Map(explanation.recommendations.map((item) => [item.productId, item]));
  const fallback = buildRuleBasedResult(ranked, input);
  const recommendations: AdvisorRecommendation[] = ranked.map((item) => {
    const generated = fallback.recommendations.find(
      ({ product }) => product.id === item.product.id,
    )!;
    const ai = byId.get(item.product.id)!;
    return { ...generated, reason: ai.reason, tradeoffs: ai.tradeoffs };
  });
  return { mode: "ai_enhanced" as AdvisorMode, recommendations, suggestions: [] };
};

const identityPriceCandidates = async (
  candidates: AdvisorCandidate[],
): Promise<PricedAdvisorCandidate[]> =>
  candidates.map((product) => ({
    product,
    effectivePrice: product.price,
    automaticPromotion: null,
  }));

export const createAdvisorService = (deps: AdvisorServiceDeps): AdvisorService => ({
  async recommend(input, requester) {
    const startedAt = Date.now();
    const requestNow = (deps.clock ?? (() => new Date()))();
    const batchSize = deps.candidateBatchSize ?? 200;
    const priceCandidates = deps.priceCandidates ?? identityPriceCandidates;
    let afterId = 0;
    let ranked: RankedAdvisorCandidate[] = [];

    while (true) {
      const candidates = await deps.repository.findCandidateBatch(input, {
        afterId,
        limit: batchSize,
      });
      if (candidates.length === 0) break;
      const priced = await priceCandidates(candidates, requestNow);
      const eligible = priced.filter((candidate) => candidate.effectivePrice <= input.budgetMax);
      ranked = selectTopAdvisorCandidates(ranked, rankCandidates(eligible, input));
      const nextAfterId = candidates[candidates.length - 1].id;
      if (nextAfterId <= afterId || candidates.length < batchSize) break;
      afterId = nextAfterId;
    }

    const finish = async (result: AdvisorResult, usage?: ProviderExplanation["usage"]) => {
      deps.logger?.info?.(
        {
          mode: result.mode,
          model: deps.model,
          latencyMs: Date.now() - startedAt,
          candidateCount: ranked.length,
          ...(usage ?? {}),
        },
        "advisor completed",
      );
      return result;
    };
    const fallback = () => finish(buildRuleBasedResult(ranked, input));
    if (!deps.provider || !deps.admission || ranked.length === 0) return fallback();
    const guard = inspectAdvisorProviderInput({ preferences: input, candidates: ranked });
    if (!guard.safe) {
      deps.logger?.warn({ category: "input_guard" }, "advisor input guard fallback");
      return fallback();
    }
    let lease: { release: () => Promise<boolean> } | undefined;
    try {
      const admission = await deps.admission.acquire(requester);
      if (admission.status !== "acquired") {
        deps.logger?.warn({ category: admission.status }, "advisor admission fallback");
        return fallback();
      }
      lease = admission.lease;
    } catch {
      deps.logger?.warn({ category: "redis_error" }, "advisor admission fallback");
      return fallback();
    }
    try {
      const explanation = await deps.provider.explain({ preferences: input, candidates: ranked });
      if (!providerMatchesRanking(ranked, explanation)) return fallback();
      return finish(withProviderExplanation(ranked, input, explanation), explanation.usage);
    } catch (error) {
      const category = error instanceof AdvisorProviderError ? error.category : "provider_5xx";
      deps.logger?.warn({ category }, "advisor provider fallback");
      return fallback();
    } finally {
      try {
        if (lease && !(await lease.release()))
          deps.logger?.warn(
            { category: "admission_release_error" },
            "advisor admission release failed",
          );
      } catch {
        deps.logger?.warn(
          { category: "admission_release_error" },
          "advisor admission release failed",
        );
      }
    }
  },
});

export { priceAdvisorCandidates };
