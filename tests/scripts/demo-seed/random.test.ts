import { DAY, createRng, earlier, shift } from "scripts/demo-seed/random";

describe("createRng", () => {
  it("replays the same sequence for the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    expect(Array.from({ length: 5 }, a.next)).toEqual(Array.from({ length: 5 }, b.next));
    expect(createRng(43).next()).not.toBe(createRng(42).next());
  });

  it("keeps helpers inside their bounds", () => {
    const rng = createRng(7);
    for (let i = 0; i < 500; i += 1) {
      const n = rng.int(3, 5);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
    }
    expect(
      rng.weighted([
        ["never", 0],
        ["always", 1],
      ] as const),
    ).toBe("always");
    expect(rng.hex(12)).toMatch(/^[0-9a-f]{12}$/);
    expect(rng.uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    const from = new Date("2026-01-01T00:00:00Z");
    const to = shift(from, DAY);
    const at = rng.dateBetween(from, to);
    expect(at >= from && at < to).toBe(true);
    expect(rng.shuffle([1, 2, 3, 4]).sort()).toEqual([1, 2, 3, 4]);
    expect(() => rng.pick([])).toThrow();
  });

  it("returns the earlier date", () => {
    const a = new Date("2026-01-01T00:00:00Z");
    expect(earlier(a, shift(a, 1))).toBe(a);
  });
});
