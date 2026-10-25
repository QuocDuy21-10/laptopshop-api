import type { ProviderRequest } from "modules/advisor/providers/advisor-provider";

export type AdvisorInputGuardResult = { safe: true } | { safe: false; category: "prompt_control" };

const CONTROL_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous|prior|system|developer)\s+instructions?/i,
  /bỏ qua\s+(?:mọi\s+)?(?:chỉ dẫn|quy tắc|hướng dẫn)/i,
  /(?:reveal|show|disclose|tiết lộ).{0,40}(?:system|developer)?\s*prompt/i,
  /(?:system|developer)\s*(?:message|prompt|instruction|role)/i,
  /(?:jailbreak|prompt\s+injection|override|ghi đè).{0,80}(?:rule|quy tắc|schema|output|kết quả)?/i,
  /đóng vai\s+(?:system|developer|quản trị viên)/i,
];

const containsControlPattern = (value: string) =>
  CONTROL_PATTERNS.some((pattern) => pattern.test(value.normalize("NFKC")));

export const inspectAdvisorProviderInput = (input: ProviderRequest): AdvisorInputGuardResult => {
  const values = [
    input.preferences.note,
    ...input.candidates.flatMap((candidate) => candidate.evidence.map((fact) => fact.text)),
  ].filter((value): value is string => Boolean(value));
  return values.some(containsControlPattern)
    ? { safe: false, category: "prompt_control" }
    : { safe: true };
};
