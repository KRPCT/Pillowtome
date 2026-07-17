import { describe, expect, it } from "vitest";
import {
  isScrolledAtSectionEnd,
  isScrolledAtSectionStart,
  isShortScrolledSection,
  isTapGesture,
} from "./scroll-mode";

describe("isScrolledAtSectionEnd", () => {
  it("true when remaining scroll is within edge and user scrolled", () => {
    expect(isScrolledAtSectionEnd(900, 1000, 1005, 8)).toBe(true);
  });

  it("false for short fully-visible section at open (start≈0)", () => {
    expect(isScrolledAtSectionEnd(0, 500, 500, 8)).toBe(false);
  });

  it("false when more content remains", () => {
    expect(isScrolledAtSectionEnd(0, 400, 1000, 8)).toBe(false);
  });
});

describe("isScrolledAtSectionStart", () => {
  it("true near zero", () => {
    expect(isScrolledAtSectionStart(0)).toBe(true);
    expect(isScrolledAtSectionStart(5)).toBe(true);
  });

  it("false when scrolled down", () => {
    expect(isScrolledAtSectionStart(40)).toBe(false);
  });
});

describe("isTapGesture", () => {
  it("accepts small movement", () => {
    expect(isTapGesture(0, 0)).toBe(true);
    expect(isTapGesture(5, 8)).toBe(true);
  });

  it("rejects pans", () => {
    expect(isTapGesture(0, 40)).toBe(false);
    expect(isTapGesture(30, 0)).toBe(false);
  });
});

describe("isShortScrolledSection", () => {
  it("true when fully visible", () => {
    expect(isShortScrolledSection(0, 400, 400)).toBe(true);
  });

  it("false when scrollable", () => {
    expect(isShortScrolledSection(0, 400, 1200)).toBe(false);
  });
});
