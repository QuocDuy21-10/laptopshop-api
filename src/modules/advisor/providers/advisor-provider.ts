import type { AdvisorInput, RankedAdvisorCandidate } from "modules/advisor/advisor.schema";

export type ProviderRequest = {
  preferences: AdvisorInput;
  candidates: RankedAdvisorCandidate[];
};

export type ProviderRecommendation = {
  productId: number;
  reason: string;
  evidenceKeys: string[];
  tradeoffs: string[];
};

export type ProviderExplanation = {
  recommendations: ProviderRecommendation[];
  usage?: { promptTokens?: number; completionTokens?: number };
};

export type AdvisorProviderFailure = "timeout" | "provider_429" | "provider_5xx" | "invalid_output";

export interface AdvisorProvider {
  explain(input: ProviderRequest): Promise<ProviderExplanation>;
}
