import { describe, expect, it } from "vitest";
import { createCloseGate } from "./scheduler";

describe("createCloseGate (D-90 dedup: at most one close push per open)", () => {
  it("close fires once until reopened", () => {
    const gate = createCloseGate();
    gate.markOpened();
    expect(gate.consumeClose()).toBe(true);
    expect(gate.consumeClose()).toBe(false);
    gate.markOpened();
    expect(gate.consumeClose()).toBe(true);
    expect(gate.consumeClose()).toBe(false);
  });

  it("background-close then unmount-close yields exactly one fire", () => {
    const gate = createCloseGate();
    gate.markOpened();
    // App goes to background → close push fires.
    expect(gate.consumeClose()).toBe(true);
    // Reader unmounts while still backgrounded → must NOT fire again.
    expect(gate.consumeClose()).toBe(false);
  });

  it("close before any open never fires", () => {
    const gate = createCloseGate();
    expect(gate.consumeClose()).toBe(false);
    expect(gate.consumeClose()).toBe(false);
  });

  it("re-open after a background close re-arms exactly one fire", () => {
    const gate = createCloseGate();
    gate.markOpened();
    expect(gate.consumeClose()).toBe(true); // background
    gate.markOpened(); // back to foreground (no re-pull — open only)
    expect(gate.consumeClose()).toBe(true); // final close
    expect(gate.consumeClose()).toBe(false);
  });
});
