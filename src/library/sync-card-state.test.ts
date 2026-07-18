import { describe, expect, it } from "vitest";
import { deriveCardState } from "./sync-card-state";

describe("deriveCardState (UI-SPEC §3 five-state matrix)", () => {
  it("local file → local, regardless of anything else", () => {
    expect(deriveCardState({ fileLocal: true, fileSyncEnabled: true }, null)).toBe("local");
    expect(deriveCardState({ fileLocal: true }, { percent: 50 })).toBe("local");
    expect(deriveCardState({ fileLocal: true }, "failed")).toBe("local");
    // Rows predating the V8 columns (fileLocal undefined) stay normal cards.
    expect(deriveCardState({}, null)).toBe("local");
  });

  it("remote-only + download in flight → downloading", () => {
    expect(deriveCardState({ fileLocal: false, fileSyncEnabled: true }, { percent: 0 })).toBe(
      "downloading",
    );
    expect(deriveCardState({ fileLocal: false, fileSyncEnabled: true }, { percent: 42 })).toBe(
      "downloading",
    );
    expect(deriveCardState({ fileLocal: false, fileSyncEnabled: true }, { percent: 99 })).toBe(
      "downloading",
    );
  });

  it("remote-only + rejected attempt → failed (tap retries)", () => {
    expect(deriveCardState({ fileLocal: false, fileSyncEnabled: true }, "failed")).toBe("failed");
  });

  it("remote-only + peer enabled file sync → downloadable", () => {
    expect(deriveCardState({ fileLocal: false, fileSyncEnabled: true }, null)).toBe(
      "downloadable",
    );
  });

  it("remote-only + peer did NOT enable → unsynced (D-102 grey)", () => {
    expect(deriveCardState({ fileLocal: false, fileSyncEnabled: false }, null)).toBe("unsynced");
    expect(deriveCardState({ fileLocal: false }, null)).toBe("unsynced");
  });

  it("a stale failed marker loses to a live download entry", () => {
    // Retry started → the in-flight entry wins over the old failure.
    expect(deriveCardState({ fileLocal: false, fileSyncEnabled: true }, { percent: 3 })).toBe(
      "downloading",
    );
  });
});
