import type { Product } from "@prisma/client";
import { toProductDto } from "modules/products/products.mapper";
import type {
  AdvisorInput,
  AdvisorRecommendation,
  RankedAdvisorCandidate,
  AdvisorResult,
} from "modules/advisor/advisor.schema";

const usageLabel: Record<AdvisorInput["usage"], string> = {
  CODING: "lập trình",
  GAMING: "gaming",
  OFFICE: "học tập và văn phòng",
  CREATIVE: "sáng tạo nội dung",
};

export const buildRuleBasedRecommendation = (
  ranked: RankedAdvisorCandidate,
  input: AdvisorInput,
): AdvisorRecommendation => {
  const highlights = ranked.evidence.slice(0, 3).map((item) => item.text);
  const reason = highlights.length
    ? `Phù hợp với nhu cầu ${usageLabel[input.usage]} dựa trên ${highlights.join(", ")}.`
    : `Phù hợp với nhu cầu ${usageLabel[input.usage]} dựa trên các thông số hiện có.`;
  const tradeoffs: string[] = [];
  if (ranked.product.cpu === null || ranked.product.gpu === null) {
    tradeoffs.push("Chưa có đủ thông tin CPU/GPU để đánh giá sâu hơn.");
  }
  if (ranked.product.weightGrams !== null && ranked.product.weightGrams > 2200) {
    tradeoffs.push(
      `Trọng lượng ${ranked.product.weightGrams} g có thể kém thuận tiện khi di chuyển.`,
    );
  }
  if (ranked.product.batteryWh === null && tradeoffs.length < 2) {
    tradeoffs.push("Chưa có thông tin dung lượng pin.");
  }
  return {
    product: toProductDto({
      ...ranked.product,
      cpuBrand: ranked.product.cpuBrand ?? null,
      gpuBrand: ranked.product.gpuBrand ?? null,
      gpuType: ranked.product.gpuType ?? null,
      resolutionTier: ranked.product.resolutionTier ?? null,
      panelType: ranked.product.panelType ?? null,
    } as Product),
    matchScore: ranked.matchScore,
    highlights,
    reason,
    tradeoffs: tradeoffs.slice(0, 2),
  };
};

export const buildRuleBasedResult = (
  ranked: RankedAdvisorCandidate[],
  input: AdvisorInput,
): AdvisorResult => ({
  mode: "rule_based",
  recommendations: ranked.map((item) => buildRuleBasedRecommendation(item, input)),
  suggestions:
    ranked.length === 0 ? ["Thử tăng ngân sách hoặc giảm RAM tối thiểu để có thêm lựa chọn."] : [],
});
