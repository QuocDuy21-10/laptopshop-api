import { advisorRequestSchema } from "modules/advisor/advisor.schema";

const valid = {
  budgetMax: 20_000_000,
  usage: "CODING" as const,
  priorities: ["PERFORMANCE", "PORTABILITY", "VALUE"] as const,
  minRamGb: 16 as const,
  workloads: ["DOCKER_VM"] as const,
  note: "  Mình thường chạy Docker  ",
};

describe("advisorRequestSchema", () => {
  it("accepts the structured advisor preferences", () => {
    const parsed = advisorRequestSchema.parse(valid);
    expect(parsed).toMatchObject({
      budgetMax: 20_000_000,
      usage: "CODING",
      priorities: ["PERFORMANCE", "PORTABILITY", "VALUE"],
      minRamGb: 16,
      workloads: ["DOCKER_VM"],
      note: "Mình thường chạy Docker",
    });
  });

  it.each([4_999_999, 200_000_001])("rejects budget %s", (budgetMax) => {
    expect(() => advisorRequestSchema.parse({ ...valid, budgetMax })).toThrow();
  });

  it.each([
    { priorities: ["PERFORMANCE", "PORTABILITY", "BATTERY", "VALUE"] },
    { priorities: ["PERFORMANCE", "PERFORMANCE"] },
    { workloads: ["DOCKER_VM", "DOCKER_VM"] },
    { minRamGb: 12 },
    { note: "a".repeat(501) },
  ])("rejects invalid preference %j", (override) => {
    expect(() => advisorRequestSchema.parse({ ...valid, ...override })).toThrow();
  });

  it("turns an empty note into undefined and defaults optional arrays", () => {
    const parsed = advisorRequestSchema.parse({
      budgetMax: "20000000",
      usage: "OFFICE",
      priorities: [],
      workloads: [],
      note: "   ",
    });
    expect(parsed.note).toBeUndefined();
    expect(parsed.workloads).toEqual([]);
  });
});
