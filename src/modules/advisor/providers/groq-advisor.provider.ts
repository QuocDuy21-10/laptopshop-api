import { z } from "zod";
import {
  AdvisorProviderError,
  type AdvisorProvider,
  type ProviderExplanation,
  type ProviderRecommendation,
  type ProviderRequest,
} from "modules/advisor/providers/advisor-provider";
import { hardwareTier } from "modules/advisor/advisor.hardware-profile";

export type GroqStructuredOutputMode = "strict" | "best_effort" | "json_object";
export type GroqAdvisorConfig = {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
  structuredOutputMode: GroqStructuredOutputMode;
};

const providerRecommendation = z
  .object({
    productId: z.number().int().positive(),
    reason: z.string().trim().min(1).max(300),
    evidenceKeys: z.array(z.string().min(1)).min(1).max(8),
    tradeoffs: z.array(z.string().trim().min(1).max(180)).max(2),
  })
  .strict();
const providerExplanation = z.object({ recommendations: z.array(providerRecommendation) }).strict();

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const SYSTEM_PROMPT =
  "Bạn chỉ được giải thích các candidate và evidence do backend cung cấp. Không tạo sản phẩm, giá, thông số, tồn kho hoặc số liệu mới. Trả JSON đúng schema.";

const responseFormat = (mode: GroqStructuredOutputMode) =>
  mode === "json_object"
    ? { type: "json_object" }
    : {
        type: "json_schema",
        json_schema: {
          name: "advisor_explanation",
          strict: mode === "strict",
          schema: {
            type: "object",
            properties: {
              recommendations: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    productId: { type: "integer" },
                    reason: { type: "string" },
                    evidenceKeys: { type: "array", items: { type: "string" } },
                    tradeoffs: { type: "array", items: { type: "string" } },
                  },
                  required: ["productId", "reason", "evidenceKeys", "tradeoffs"],
                  additionalProperties: false,
                },
              },
            },
            required: ["recommendations"],
            additionalProperties: false,
          },
        },
      };

const numbersIn = (value: string) =>
  [...value.matchAll(/\d+(?:[.,]\d+)?/g)].map(([token]) => token.replace(",", "."));

const invalid = (message: string): AdvisorProviderError =>
  new AdvisorProviderError("invalid_output", message);

export class GroqAdvisorProvider implements AdvisorProvider {
  constructor(
    private readonly config: GroqAdvisorConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async explain(input: ProviderRequest): Promise<ProviderExplanation> {
    const candidates = input.candidates.map(({ product, matchScore, evidence }) => ({
      id: product.id,
      name: product.name,
      price: product.price,
      cpu: hardwareTier("cpu", product.cpu) === "unknown" ? null : product.cpu,
      gpu: hardwareTier("gpu", product.gpu) === "unknown" ? null : product.gpu,
      ramGb: product.ramGb,
      storageGb: product.storageGb,
      screenResolution: product.screenResolution,
      refreshRateHz: product.refreshRateHz,
      batteryWh: product.batteryWh,
      weightGrams: product.weightGrams,
      warrantyMonths: product.warrantyMonths,
      matchScore,
      evidence,
    }));
    const payload = {
      model: this.config.model,
      temperature: 0.2,
      max_completion_tokens: this.config.maxOutputTokens,
      response_format: responseFormat(this.config.structuredOutputMode),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            preferences: input.preferences,
            note: input.preferences.note,
            candidates,
          }),
        },
      ],
    };

    let response: Response;
    try {
      response = await this.fetchImpl(GROQ_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      if (
        (error as { name?: string })?.name === "AbortError" ||
        (error as { name?: string })?.name === "TimeoutError"
      ) {
        throw new AdvisorProviderError("timeout", "Groq request timed out");
      }
      throw new AdvisorProviderError("provider_5xx", "Groq request failed");
    }
    if (response.status === 429)
      throw new AdvisorProviderError("provider_429", "Groq quota exceeded");
    if (!response.ok)
      throw new AdvisorProviderError("provider_5xx", `Groq returned HTTP ${response.status}`);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw invalid("Groq response was not JSON");
    }
    const content = (body as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]
      ?.message?.content;
    if (typeof content !== "string") throw invalid("Groq response did not contain message content");
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw invalid("Groq content was not valid JSON");
    }
    const validated = providerExplanation.safeParse(parsed);
    if (!validated.success) throw invalid("Groq output did not match the advisor schema");
    if (
      validated.data.recommendations.length !== input.candidates.length ||
      validated.data.recommendations.some(
        (item, index) => item.productId !== input.candidates[index].product.id,
      )
    ) {
      throw invalid("Groq changed the ranked candidate list");
    }

    const allowedEvidence = new Map(
      input.candidates.map((candidate) => [candidate.product.id, candidate.evidence]),
    );
    for (const item of validated.data.recommendations) {
      const evidence = allowedEvidence.get(item.productId);
      if (
        !evidence ||
        item.evidenceKeys.some((key) => !evidence.some((fact) => fact.key === key))
      ) {
        throw invalid("Groq referenced unknown evidence");
      }
      const referencedFacts = item.evidenceKeys
        .map((key) => evidence.find((fact) => fact.key === key))
        .filter(Boolean);
      const allowedNumbers = new Set([
        ...referencedFacts.flatMap((fact) => numbersIn(fact.text)),
        ...numbersIn(JSON.stringify(input.preferences)),
      ]);
      const prose = [item.reason, ...item.tradeoffs].flatMap(numbersIn);
      if (prose.some((token) => !allowedNumbers.has(token)))
        throw invalid("Groq introduced an unsupported number");
      const allProse = [item.reason, ...item.tradeoffs].join(" ");
      const featureClaims: Array<{ feature: string; pattern: RegExp; evidencePrefix: string }> = [
        {
          feature: "cpu",
          pattern: /cpu|bộ xử lý|vi xử lý|processor|chip/i,
          evidencePrefix: "cpu-",
        },
        { feature: "gpu", pattern: /gpu|card đồ họa|đồ họa|graphics/i, evidencePrefix: "gpu-" },
        { feature: "battery", pattern: /pin|thời lượng/i, evidencePrefix: "battery-" },
        {
          feature: "display",
          pattern: /màn hình|display|tần số|độ phân giải/i,
          evidencePrefix: "resolution-",
        },
        {
          feature: "portability",
          pattern: /nhẹ|nặng|di chuyển|trọng lượng/i,
          evidencePrefix: "weight-",
        },
      ];
      for (const claim of featureClaims) {
        if (
          claim.pattern.test(allProse) &&
          !item.evidenceKeys.some((key) => key.startsWith(claim.evidencePrefix))
        ) {
          throw invalid(`Groq made an unsupported ${claim.feature} claim`);
        }
      }
    }
    const usage = (body as { usage?: { prompt_tokens?: number; completion_tokens?: number } })
      .usage;
    return {
      recommendations: validated.data.recommendations as ProviderRecommendation[],
      ...(usage
        ? {
            usage: { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens },
          }
        : {}),
    };
  }
}
