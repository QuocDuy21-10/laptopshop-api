export type HardwareTier = "unknown" | "entry" | "mainstream" | "performance" | "high_end";

export const HARDWARE_TIER_SCORE: Record<HardwareTier, number> = {
  unknown: 0,
  entry: 0.25,
  mainstream: 0.5,
  performance: 0.75,
  high_end: 1,
};

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const profiles: Record<"cpu" | "gpu", Array<{ tier: HardwareTier; patterns: string[] }>> = {
  cpu: [
    { tier: "high_end", patterns: ["i7-12700h"] },
    { tier: "performance", patterns: ["i5-11400h", "i7-1360p", "apple m2", "i5-13420h"] },
    { tier: "mainstream", patterns: ["i5-1235u", "i5-10300h", "apple m1", "i5-1135g7"] },
    { tier: "entry", patterns: ["i7-6500u"] },
  ],
  gpu: [
    { tier: "high_end", patterns: ["rtx 4050"] },
    { tier: "performance", patterns: ["rtx 3050", "rtx 2050"] },
    { tier: "mainstream", patterns: ["gtx 1650", "apple gpu 8 nhan"] },
    { tier: "entry", patterns: ["gtx 950m", "iris xe", "iris plus", "apple gpu 7 nhan"] },
  ],
};

export const hardwareTier = (kind: "cpu" | "gpu", value: string | null): HardwareTier => {
  if (!value) return "unknown";
  const normalized = normalize(value);
  return (
    profiles[kind].find((profile) =>
      profile.patterns.some((pattern) => normalized.includes(pattern)),
    )?.tier ?? "unknown"
  );
};
