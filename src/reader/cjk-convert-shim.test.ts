import { describe, expect, it } from "vitest";
import { convertText, isConvertMode } from "./cjk-convert-shim";

describe("convertText (OpenCC)", () => {
  it("simplified → traditional, context-aware", () => {
    // 干 disambiguates to 乾 in 干杯; 后 → 後; 里 stays char-form.
    expect(convertText("干杯后天见", "s2t")).toBe("乾杯後天見");
  });

  it("traditional → simplified", () => {
    expect(convertText("乾杯後天見", "t2s")).toBe("干杯后天见");
  });

  it("off is a no-op", () => {
    expect(convertText("干杯后天见", "off")).toBe("干杯后天见");
  });

  it("is (near-)length-preserving — CFI-friendly", () => {
    const s = "计算机软件网络里程后天开发";
    expect(convertText(s, "s2t").length).toBe(s.length);
  });

  it("round-trips common text", () => {
    const s = "他说这个软件很好用";
    expect(convertText(convertText(s, "s2t"), "t2s")).toBe(s);
  });
});

describe("isConvertMode", () => {
  it("guards the enum", () => {
    expect(isConvertMode("s2t")).toBe(true);
    expect(isConvertMode("t2s")).toBe(true);
    expect(isConvertMode("off")).toBe(true);
    expect(isConvertMode("zh")).toBe(false);
  });
});
