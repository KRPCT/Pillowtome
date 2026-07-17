import { describe, expect, it } from "vitest";
import {
  capWindow,
  extendWindow,
  MAX_LOADED,
  seedWindow,
  SEED_AHEAD,
  SEED_BEHIND,
} from "./scroll-window";

const isContiguous = (w: number[]) =>
  w.every((v, i) => i === 0 || v === w[i - 1] + 1);

describe("seedWindow", () => {
  it("seeds a fresh contiguous band around the target", () => {
    const w = seedWindow([], 10, 100);
    expect(w).toEqual([9, 10, 11, 12]);
    expect(isContiguous(w)).toBe(true);
  });

  it("drops the old band entirely on a far jump", () => {
    const w = seedWindow([2, 3, 4, 5], 80, 100);
    expect(w).toEqual([79, 80, 81, 82]);
  });

  it("extends (not resets) a near jump to avoid reload flicker", () => {
    const w = seedWindow([4, 5, 6], 7, 100);
    expect(w).toContain(4);
    expect(w).toContain(9);
    expect(isContiguous(w)).toBe(true);
  });

  it("clamps at book edges", () => {
    expect(seedWindow([], 0, 100)).toEqual([0, 1, 2]);
    expect(seedWindow([], 99, 100)).toEqual([98, 99]);
  });
});

describe("capWindow", () => {
  it("is a no-op under the cap", () => {
    const r = capWindow([3, 4, 5], 4);
    expect(r.window).toEqual([3, 4, 5]);
    expect(r.removedTop).toEqual([]);
    expect(r.removedBottom).toEqual([]);
  });

  it("evicts the end farther from the anchor and keeps the anchor", () => {
    const band = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const r = capWindow(band, 8, MAX_LOADED); // anchor near the bottom
    expect(r.window.length).toBe(MAX_LOADED);
    expect(r.window).toContain(8);
    expect(isContiguous(r.window)).toBe(true);
    expect(r.removedTop).toEqual([0, 1, 2]); // dropped from above
    expect(r.removedBottom).toEqual([]);
  });

  it("evicts from the bottom when the anchor is near the top", () => {
    const band = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const r = capWindow(band, 1, MAX_LOADED);
    expect(r.window).toContain(1);
    expect(r.removedTop).toEqual([]);
    expect(r.removedBottom.length).toBe(3);
  });
});

describe("stress: bounded + contiguous under many jumps and scrolls", () => {
  // Deterministic PRNG (no Math.random — must be reproducible).
  function mulberry32(seed: number) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("never exceeds MAX_LOADED and stays contiguous across 2000 ops", () => {
    const LEN = 240;
    const rng = mulberry32(1234);
    let loaded = seedWindow([], 0, LEN);
    let anchor = 0;
    let maxSeen = loaded.length;

    for (let step = 0; step < 2000; step++) {
      const roll = rng();
      if (roll < 0.35) {
        // TOC jump anywhere in the book.
        const target = Math.floor(rng() * LEN);
        loaded = seedWindow(loaded, target, LEN);
        anchor = target;
      } else {
        // Scroll: extend toward an edge, then the reader advances the anchor.
        const nearTop = rng() < 0.5;
        loaded = extendWindow(loaded, { nearTop, nearBottom: !nearTop }, LEN);
        anchor = nearTop
          ? Math.max(loaded[0], anchor - 1)
          : Math.min(loaded[loaded.length - 1], anchor + 1);
      }
      const capped = capWindow(loaded, anchor, MAX_LOADED);
      loaded = capped.window;
      maxSeen = Math.max(maxSeen, loaded.length);

      expect(loaded.length).toBeLessThanOrEqual(MAX_LOADED);
      expect(isContiguous(loaded)).toBe(true);
      expect(loaded).toContain(anchor); // never evict what we're reading
    }
    // The window genuinely fills (not trivially tiny) yet stays capped.
    expect(maxSeen).toBe(MAX_LOADED);
  });
});

describe("seed constants are sane", () => {
  it("seed band fits under the cap", () => {
    expect(SEED_BEHIND + SEED_AHEAD + 1).toBeLessThanOrEqual(MAX_LOADED);
  });
});
