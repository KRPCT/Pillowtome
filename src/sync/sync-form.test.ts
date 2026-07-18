import { describe, expect, it } from "vitest";
import { copyForTestClass, normalizeRemotePath, validateServerUrl } from "./sync-form";

describe("validateServerUrl", () => {
  it("accepts https and http URLs with a host", () => {
    expect(validateServerUrl("https://dav.jianguoyun.com/dav")).toBeNull();
    expect(validateServerUrl("http://192.168.1.10:5005")).toBeNull();
    expect(validateServerUrl("  https://dav.example.com/dav  ")).toBeNull();
  });

  it("rejects missing scheme, non-http schemes, and missing host", () => {
    expect(validateServerUrl("dav.jianguoyun.com")).toBe("invalid");
    expect(validateServerUrl("ftp://dav.example.com")).toBe("invalid");
    expect(validateServerUrl("https://")).toBe("invalid");
    expect(validateServerUrl("")).toBe("invalid");
    expect(validateServerUrl("   ")).toBe("invalid");
  });
});

describe("normalizeRemotePath (D-104)", () => {
  it("strips a leading slash and attaches exactly one trailing slash", () => {
    expect(normalizeRemotePath("/pillowtome")).toBe("pillowtome/");
    expect(normalizeRemotePath("pillowtome")).toBe("pillowtome/");
    expect(normalizeRemotePath("pillowtome/")).toBe("pillowtome/");
    expect(normalizeRemotePath("pillowtome///")).toBe("pillowtome/");
    expect(normalizeRemotePath("/dav/books")).toBe("dav/books/");
  });

  it("empty or blank input falls back to pillowtome/", () => {
    expect(normalizeRemotePath(" ")).toBe("pillowtome/");
    expect(normalizeRemotePath("")).toBe("pillowtome/");
    expect(normalizeRemotePath("/")).toBe("pillowtome/");
  });
});

describe("copyForTestClass (client-side only — backend classes arrive verbatim)", () => {
  it("invalid URL → the D-97 unreachable copy", () => {
    expect(copyForTestClass("invalid")).toBe("无法连接到服务器，请检查地址");
  });
});
