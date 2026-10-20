import { buildRuleBasedResult } from "modules/advisor/advisor.explanation";
import type { AdvisorRepository } from "modules/advisor/advisor.repository";
import { rankCandidates } from "modules/advisor/advisor.ranking";
import type {
  AdvisorInput,
  AdvisorMode,
  AdvisorRecommendation,
  AdvisorResult,
  RankedAdvisorCandidate,
} from "modules/advisor/advisor.schema";
import type {
  AdvisorProvider,
  ProviderExplanation,
} from "modules/advisor/providers/advisor-provider";

export type AdvisorRequester = { kind: "guest" | "user"; key: string };

export interface AdvisorQuota {
  tryReserve(requester: AdvisorRequester): Promise<boolean>;
}

export type AdvisorServiceDeps = {
  repository: AdvisorRepository;
  provider?: AdvisorProvider;
  quota?: AdvisorQuota;
  logger?: { warn: (object: unknown, message?: string) => void };
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

export const createAdvisorService = (deps: AdvisorServiceDeps): AdvisorService => ({
  async recommend(input, requester) {
    const candidates = await deps.repository.findCandidates(input);
    const ranked = rankCandidates(candidates, input);
    const fallback = () => buildRuleBasedResult(ranked, input);
    if (!deps.provider || !deps.quota || ranked.length === 0) return fallback();
    try {
      if (!(await deps.quota.tryReserve(requester))) return fallback();
      const explanation = await deps.provider.explain({ preferences: input, candidates: ranked });
      if (!providerMatchesRanking(ranked, explanation)) return fallback();
      return withProviderExplanation(ranked, input, explanation);
    } catch (error) {
      deps.logger?.warn({ error }, "advisor provider fallback");
      return fallback();
    }
  },
});
