import { HARDWARE_TIER_SCORE, hardwareTier } from "modules/advisor/advisor.hardware-profile";
import type {
  AdvisorEvidence,
  AdvisorFeature,
  AdvisorFeatureScores,
  AdvisorInput,
  AdvisorWeights,
  PricedAdvisorCandidate,
  RankedAdvisorCandidate,
} from "modules/advisor/advisor.schema";

export const SCORING_VERSION = "advisor-v1";

const FEATURES: AdvisorFeature[] = [
  "cpu",
  "gpu",
  "ramStorage",
  "battery",
  "portability",
  "display",
  "value",
];

const baseWeights: Record<AdvisorInput["usage"], AdvisorWeights> = {
  CODING: { cpu: 25, gpu: 5, ramStorage: 25, battery: 10, portability: 10, display: 10, value: 15 },
  GAMING: { cpu: 20, gpu: 30, ramStorage: 15, battery: 5, portability: 5, display: 15, value: 10 },
  OFFICE: { cpu: 15, gpu: 0, ramStorage: 20, battery: 20, portability: 15, display: 10, value: 20 },
  CREATIVE: { cpu: 20, gpu: 25, ramStorage: 20, battery: 5, portability: 5, display: 20, value: 5 },
};

const add = (weights: AdvisorWeights, feature: AdvisorFeature, amount: number) => {
  weights[feature] += amount;
};

export const weightsFor = (input: AdvisorInput): AdvisorWeights => {
  const weights = { ...baseWeights[input.usage] };
  for (const priority of input.priorities) {
    if (priority === "PERFORMANCE") {
      add(weights, "cpu", 5);
      add(weights, "gpu", 5);
    } else if (priority === "PORTABILITY") add(weights, "portability", 10);
    else if (priority === "BATTERY") add(weights, "battery", 10);
    else if (priority === "DISPLAY") add(weights, "display", 10);
    else if (priority === "VALUE") add(weights, "value", 10);
  }
  for (const workload of input.workloads) {
    if (workload === "DOCKER_VM") {
      add(weights, "cpu", 5);
      add(weights, "ramStorage", 10);
    } else if (workload === "ESPORTS") {
      add(weights, "gpu", 10);
      add(weights, "display", 5);
    } else if (workload === "AAA_GAMING") add(weights, "gpu", 15);
    else if (workload === "PHOTO_VIDEO") {
      add(weights, "cpu", 7);
      add(weights, "ramStorage", 8);
      add(weights, "display", 10);
    } else if (workload === "CAD_3D") {
      add(weights, "cpu", 10);
      add(weights, "gpu", 15);
    }
  }
  const total = FEATURES.reduce((sum, feature) => sum + weights[feature], 0);
  return Object.fromEntries(
    FEATURES.map((feature) => [feature, weights[feature] / total]),
  ) as AdvisorWeights;
};

const ramScore = (ramGb: number | null) =>
  ramGb === null ? 0 : ramGb < 8 ? 0.2 : ramGb < 16 ? 0.4 : ramGb < 32 ? 0.75 : 1;
const storageScore = (storageGb: number | null) =>
  storageGb === null
    ? 0
    : storageGb < 256
      ? 0.2
      : storageGb < 512
        ? 0.35
        : storageGb < 1024
          ? 0.7
          : 1;
const batteryScore = (batteryWh: number | null) =>
  batteryWh === null
    ? 0
    : batteryWh <= 40
      ? 0.2
      : batteryWh <= 50
        ? 0.5
        : batteryWh <= 65
          ? 0.75
          : 1;
const portabilityScore = (weightGrams: number | null) =>
  weightGrams === null
    ? 0
    : weightGrams <= 1200
      ? 1
      : weightGrams <= 1500
        ? 0.85
        : weightGrams <= 1800
          ? 0.65
          : weightGrams <= 2200
            ? 0.4
            : 0.2;
const resolutionScore = (resolution: string | null) => {
  if (!resolution) return 0;
  const match = resolution.match(/^(\d+)x(\d+)$/i);
  if (!match) return 0;
  const pixels = Number(match[1]) * Number(match[2]);
  return pixels < 1920 * 1080 ? 0.2 : pixels === 1920 * 1080 ? 0.6 : 0.9;
};
const refreshScore = (refreshRateHz: number | null) =>
  refreshRateHz === null ? 0 : refreshRateHz <= 60 ? 0.4 : refreshRateHz < 120 ? 0.65 : 1;
const priceFit = (price: number, budgetMax: number) =>
  Math.max(0, Math.min(1, (budgetMax - price) / budgetMax));

export const featureScoresFor = (
  candidate: PricedAdvisorCandidate,
  input: AdvisorInput,
): AdvisorFeatureScores => {
  const product = candidate.product;
  return {
    cpu: HARDWARE_TIER_SCORE[hardwareTier("cpu", product.cpu)],
    gpu: HARDWARE_TIER_SCORE[hardwareTier("gpu", product.gpu)],
    ramStorage: (ramScore(product.ramGb) + storageScore(product.storageGb)) / 2,
    battery: batteryScore(product.batteryWh),
    portability: portabilityScore(product.weightGrams),
    display: (resolutionScore(product.screenResolution) + refreshScore(product.refreshRateHz)) / 2,
    value:
      0.7 * priceFit(candidate.effectivePrice, input.budgetMax) +
      0.3 * Math.min((product.warrantyMonths ?? 0) / 36, 1),
  };
};

const evidenceKey = (prefix: string, value: string | number) =>
  `${prefix}-${String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")}`;

const buildEvidence = (candidate: PricedAdvisorCandidate): AdvisorEvidence[] => {
  const product = candidate.product;
  const evidence: AdvisorEvidence[] = [];
  if (product.cpu && hardwareTier("cpu", product.cpu) !== "unknown")
    evidence.push({ key: evidenceKey("cpu", product.cpu), text: `CPU ${product.cpu}` });
  if (product.gpu && hardwareTier("gpu", product.gpu) !== "unknown")
    evidence.push({ key: evidenceKey("gpu", product.gpu), text: `GPU ${product.gpu}` });
  if (product.ramGb !== null)
    evidence.push({ key: `ram-${product.ramGb}gb`, text: `RAM ${product.ramGb} GB` });
  if (product.storageGb !== null)
    evidence.push({
      key: `storage-${product.storageGb}gb`,
      text: `Ổ cứng ${product.storageGb} GB`,
    });
  if (product.batteryWh !== null)
    evidence.push({ key: `battery-${product.batteryWh}wh`, text: `Pin ${product.batteryWh} Wh` });
  if (product.weightGrams !== null)
    evidence.push({
      key: `weight-${product.weightGrams}g`,
      text: `Trọng lượng ${product.weightGrams} g`,
    });
  if (product.screenResolution)
    evidence.push({
      key: evidenceKey("resolution", product.screenResolution),
      text: `Độ phân giải ${product.screenResolution}`,
    });
  if (product.refreshRateHz !== null)
    evidence.push({
      key: `refresh-${product.refreshRateHz}hz`,
      text: `Tần số quét ${product.refreshRateHz} Hz`,
    });
  if (product.warrantyMonths !== null)
    evidence.push({
      key: `warranty-${product.warrantyMonths}months`,
      text: `Bảo hành ${product.warrantyMonths} tháng`,
    });
  evidence.push({
    key: `price-${candidate.effectivePrice}`,
    text: `Giá tư vấn ${candidate.effectivePrice.toLocaleString("vi-VN")} đồng`,
  });
  return evidence;
};

export const scoreAdvisorCandidate = (
  candidate: PricedAdvisorCandidate,
  input: AdvisorInput,
): RankedAdvisorCandidate => {
  const weights = weightsFor(input);
  const features = featureScoresFor(candidate, input);
  const rawScore = FEATURES.reduce((sum, feature) => sum + features[feature] * weights[feature], 0);
  return {
    product: candidate.product,
    effectivePrice: candidate.effectivePrice,
    automaticPromotion: candidate.automaticPromotion,
    rawScore,
    matchScore: Math.round(rawScore * 100),
    features,
    evidence: buildEvidence(candidate),
  };
};

const compareRankedCandidates = (a: RankedAdvisorCandidate, b: RankedAdvisorCandidate) =>
  b.rawScore - a.rawScore || a.effectivePrice - b.effectivePrice || a.product.id - b.product.id;

export const selectTopAdvisorCandidates = (
  current: RankedAdvisorCandidate[],
  incoming: RankedAdvisorCandidate[],
  limit = 3,
): RankedAdvisorCandidate[] =>
  [...current, ...incoming].sort(compareRankedCandidates).slice(0, limit);

export const rankCandidates = (
  candidates: PricedAdvisorCandidate[],
  input: AdvisorInput,
): RankedAdvisorCandidate[] =>
  selectTopAdvisorCandidates(
    [],
    candidates.map((candidate) => scoreAdvisorCandidate(candidate, input)),
  );
