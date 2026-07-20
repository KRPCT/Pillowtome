import { describe, expect, it } from "vitest";
import { unwrapCascadeLayers } from "./css-unwrap-layers";

describe("unwrapCascadeLayers", () => {
  it("unwraps a simple layer block", () => {
    const css = "@layer utilities{.fixed{position:fixed}}";
    expect(unwrapCascadeLayers(css)).toBe(".fixed{position:fixed}");
  });

  it("drops @layer order statements", () => {
    const css = "@layer theme, base, utilities;@layer theme{:root{--a:1}}";
    expect(unwrapCascadeLayers(css)).toBe(":root{--a:1}");
  });

  it("keeps nested @media/@supports inside layers, with matching braces", () => {
    const css =
      "@layer base{@media(min-width:720px){.a{color:red}}@supports(color:oklch(0 0 0)){.b{color:blue}}}";
    expect(unwrapCascadeLayers(css)).toBe(
      "@media(min-width:720px){.a{color:red}}@supports(color:oklch(0 0 0)){.b{color:blue}}",
    );
  });

  it("ignores braces inside strings and comments", () => {
    const css = '@layer utilities{.a{content:"}{"}}/* { unbalanced */.b{content:\'{\'}}';
    expect(unwrapCascadeLayers(css)).toBe('.a{content:"}{"}/* { unbalanced */.b{content:\'{\'}}');
  });

  it("handles multiple sequential layers and unlayered rules", () => {
    const css =
      "@layer theme{:root{--x:1}}@layer utilities{.fixed{position:fixed}}.hand{color:black}@layer components;.plain{margin:0}";
    expect(unwrapCascadeLayers(css)).toBe(
      ":root{--x:1}.fixed{position:fixed}.hand{color:black}.plain{margin:0}",
    );
  });

  it("leaves layer-free css untouched", () => {
    const css = "@media(max-width:480px){.a{top:0}}.b{left:0}";
    expect(unwrapCascadeLayers(css)).toBe(css);
  });

  it("only treats @layer (not @keyframes/@layered-ident) as a layer", () => {
    const css = "@keyframes spin{to{transform:rotate(360deg)}}";
    expect(unwrapCascadeLayers(css)).toBe(css);
  });
});
