import { describe, expect, it } from "vitest";
import {
  applyPaginatorMotion,
  paginateAnimationAllowed,
} from "./paginator-motion";

describe("paginateAnimationAllowed", () => {
  it("allows animation unless reduced-motion is requested", () => {
    expect(paginateAnimationAllowed(false)).toBe(true);
    expect(paginateAnimationAllowed(true)).toBe(false);
  });
});

describe("applyPaginatorMotion", () => {
  function makeRenderer() {
    const attrs = new Map<string, string>();
    return {
      attrs,
      setAttribute: (n: string, v: string) => void attrs.set(n, v),
      removeAttribute: (n: string) => void attrs.delete(n),
    };
  }

  it("sets the foliate `animated` attribute when allowed", () => {
    const r = makeRenderer();
    applyPaginatorMotion(r, false);
    expect(r.attrs.get("animated")).toBe("");
  });

  it("removes `animated` under prefers-reduced-motion", () => {
    const r = makeRenderer();
    applyPaginatorMotion(r, false);
    applyPaginatorMotion(r, true);
    expect(r.attrs.has("animated")).toBe(false);
  });

  it("tolerates a null renderer", () => {
    expect(() => applyPaginatorMotion(null, false)).not.toThrow();
    expect(() => applyPaginatorMotion(undefined, true)).not.toThrow();
  });
});
