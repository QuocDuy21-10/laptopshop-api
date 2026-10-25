import type { AdvisorInput, RankedAdvisorCandidate } from "modules/advisor/advisor.schema";
import type {
  ProviderExplanationData,
  ProviderRecommendation,
} from "modules/advisor/providers/advisor-output.schema";

export type ProviderRequest = {
  preferences: AdvisorInput;
  candidates: RankedAdvisorCandidate[];
};

export type ProviderExplanation = ProviderExplanationData & {
  usage?: { promptTokens?: number; completionTokens?: number };
};

export type { ProviderRecommendation };

export type AdvisorProviderFailure =
  | "timeout"
  | "provider_rate_limited"
  | "authentication"
  | "invalid_request"
  | "provider_5xx"
  | "incomplete_output"
  | "invalid_output";

export class AdvisorProviderError extends Error {
  constructor(
    public category: AdvisorProviderFailure,
    message: string,
  ) {
    super(message);
    this.name = "AdvisorProviderError";
  }
}

export interface AdvisorProvider {
  explain(input: ProviderRequest): Promise<ProviderExplanation>;
}
