export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const shift = (date: Date, ms: number) => new Date(date.getTime() + ms);
export const earlier = (a: Date, b: Date) => (a <= b ? a : b);

export type Rng = {
  next: () => number;
  int: (min: number, max: number) => number;
  chance: (probability: number) => boolean;
  pick: <T>(items: readonly T[]) => T;
  weighted: <T>(entries: readonly (readonly [T, number])[]) => T;
  shuffle: <T>(items: readonly T[]) => T[];
  dateBetween: (from: Date, to: Date) => Date;
  hex: (length: number) => string;
  uuid: () => string;
};

export const createRng = (seed: number): Rng => {
  let state = seed >>> 0;
  // mulberry32: tiny and identical on every Node version, so the demo data replays exactly
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const hex = (length: number) => Array.from({ length }, () => int(0, 15).toString(16)).join("");
  return {
    next,
    int,
    chance: (probability) => next() < probability,
    pick: (items) => {
      if (items.length === 0) throw new Error("demo seed: pick from an empty list");
      return items[int(0, items.length - 1)];
    },
    weighted: (entries) => {
      const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
      let roll = next() * total;
      for (const [value, weight] of entries) {
        roll -= weight;
        if (roll < 0) return value;
      }
      return entries[entries.length - 1][0];
    },
    shuffle: (items) => {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = int(0, i);
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },
    dateBetween: (from, to) =>
      new Date(from.getTime() + Math.floor(next() * (to.getTime() - from.getTime()))),
    hex,
    uuid: () => `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`,
  };
};
