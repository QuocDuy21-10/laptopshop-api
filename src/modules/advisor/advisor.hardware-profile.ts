export type HardwareTier = "unknown" | "entry" | "mainstream" | "performance" | "high_end";

export const HARDWARE_TIER_SCORE: Record<HardwareTier, number> = {
  unknown: 0,
  entry: 0.25,
  mainstream: 0.5,
  performance: 0.75,
  high_end: 1,
};

const normalize = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// Rules classify by family, generation and suffix so new models do not fall back to "unknown".
const intelUltraTier = (cpu: string): HardwareTier | undefined => {
  const match = cpu.match(/core ultra ([579])\s*\d{3}([a-z]*)/);
  if (!match) return undefined;
  const highPower = match[2].startsWith("h");
  if (match[1] === "5") return highPower ? "performance" : "mainstream";
  return highPower ? "high_end" : "performance";
};

const intelCoreTier = (cpu: string): HardwareTier | undefined => {
  const match = cpu.match(/\bi([3579])[- ](\d{4,5})([a-z]*)/);
  if (!match) return undefined;
  const [, rawTier, digits, suffix] = match;
  const tier = Number(rawTier);
  // 5-digit models and 4-digit models from gen 10+ (1135G7, 1235U) carry a 2-digit generation
  const generation = Number(
    digits.length === 5 || digits.startsWith("1") ? digits.slice(0, 2) : digits[0],
  );
  if (tier === 3 || generation < 8) return "entry";
  if (suffix.startsWith("h")) {
    if (tier === 9 || (tier === 7 && (generation >= 12 || suffix === "hx"))) return "high_end";
    if (tier === 7 || generation >= 11) return "performance";
    return "mainstream";
  }
  if (tier >= 7) return generation >= 12 ? "performance" : "mainstream";
  return generation >= 10 ? "mainstream" : "entry";
};

const ryzenTier = (cpu: string): HardwareTier | undefined => {
  const match = cpu.match(/ryzen (ai )?(?:pro )?([3579])\b(.*)/);
  if (!match) return undefined;
  const [, ai, rawTier, rest] = match;
  const tier = Number(rawTier);
  const model = rest.match(/\d{4}/)?.[0];
  const recent = Boolean(ai) || (model !== undefined && Number(model[0]) >= 6);
  const highPower = /\bh[sx]?\b/.test(rest.replace(/\d+/g, " "));
  if (tier === 3) return highPower ? "mainstream" : "entry";
  if (highPower) {
    if (tier === 9 || (tier === 7 && recent)) return "high_end";
    return "performance";
  }
  if (tier >= 7) return recent ? "performance" : "mainstream";
  return "mainstream";
};

const appleTier = (chip: string): HardwareTier | undefined => {
  const match = chip.match(/apple m(\d+)(?: (pro|max|ultra))?/);
  if (!match) return undefined;
  if (match[2]) return "high_end";
  return match[1] === "1" ? "mainstream" : "performance";
};

const cpuTier = (cpu: string) =>
  intelUltraTier(cpu) ?? intelCoreTier(cpu) ?? ryzenTier(cpu) ?? appleTier(cpu);

const gpuTier = (gpu: string): HardwareTier | undefined => {
  const rtx = gpu.match(/rtx (\d{2})(\d{2})\b/);
  if (rtx) {
    const [series, gpuClass] = [Number(rtx[1]), Number(rtx[2])];
    return gpuClass >= 60 || (gpuClass === 50 && series >= 40) ? "high_end" : "performance";
  }
  const gtx = gpu.match(/gtx (\d{3,4})/);
  if (gtx) return Number(gtx[1]) >= 1050 ? "mainstream" : "entry";
  if (/\brx \d{4}/.test(gpu) || /\barc a\d{3}/.test(gpu)) return "performance";
  if (/radeon \d{3}m\b/.test(gpu) || /\barc\b/.test(gpu)) return "mainstream";
  if (/iris (?:xe|plus)|uhd graphics|radeon graphics/.test(gpu)) return "entry";
  const appleCores = gpu.match(/apple gpu (\d+)/);
  if (appleCores) {
    const cores = Number(appleCores[1]);
    return cores >= 10 ? "performance" : cores >= 8 ? "mainstream" : "entry";
  }
  return undefined;
};

export const hardwareTier = (kind: "cpu" | "gpu", value: string | null): HardwareTier => {
  if (!value) return "unknown";
  const normalized = normalize(value);
  return (kind === "cpu" ? cpuTier(normalized) : gpuTier(normalized)) ?? "unknown";
};
