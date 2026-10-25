import { z } from "zod";

export const providerRecommendationSchema = z
  .object({
    productId: z.number().int().positive(),
    reason: z.string().trim().min(1).max(300),
    evidenceKeys: z.array(z.string().min(1)).min(1).max(8),
    tradeoffs: z.array(z.string().trim().min(1).max(180)).max(2),
  })
  .strict();

export const providerExplanationSchema = z
  .object({ recommendations: z.array(providerRecommendationSchema).max(3) })
  .strict();

export type ProviderRecommendation = z.infer<typeof providerRecommendationSchema>;
export type ProviderExplanationData = z.infer<typeof providerExplanationSchema>;

export const providerExplanationJsonSchema = {
  type: "object",
  properties: {
    recommendations: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          productId: { type: "integer", minimum: 1 },
          reason: { type: "string", minLength: 1, maxLength: 300 },
          evidenceKeys: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: { type: "string", minLength: 1 },
          },
          tradeoffs: {
            type: "array",
            maxItems: 2,
            items: { type: "string", minLength: 1, maxLength: 180 },
          },
        },
        required: ["productId", "reason", "evidenceKeys", "tradeoffs"],
        additionalProperties: false,
      },
    },
  },
  required: ["recommendations"],
  additionalProperties: false,
} as const;
