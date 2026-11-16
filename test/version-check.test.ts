import { describe, expect, it } from "vitest";
import { checkVersion, highestRelease, parseNpmView } from "../scripts/version-check.mjs";

describe("checkVersion", () => {
  it("allows any x.y.z when only the staged placeholder exists", () => {
    expect(checkVersion("1.0.0", ["0.0.0-stage"]).ok).toBe(true);
  });

  it("allows any x.y.z when only prereleases exist", () => {
    expect(checkVersion("1.0.0", ["1.0.0-rc.1", "2.0.0-beta.3"]).ok).toBe(true);
  });

  it("allows any x.y.z when the package does not exist", () => {
    expect(checkVersion("1.0.0", null).ok).toBe(true);
  });

  it("refuses a version equal to the highest release", () => {
    expect(checkVersion("1.0.0", ["0.0.0-stage", "1.0.0"])).toEqual({
      ok: false,
      message: "Version 1.0.0 is not above the highest npm release 1.0.0",
    });
  });

  it("refuses a version below the highest release", () => {
    expect(checkVersion("1.2.9", ["1.3.0"]).ok).toBe(false);
  });

  it("allows a version above the highest release", () => {
    expect(checkVersion("1.3.1", ["1.3.0"]).ok).toBe(true);
  });

  it("compares numerically against the highest of many versions", () => {
    const published = ["1.9.0", "1.10.0", "0.0.0-stage", "1.2.0", "2.0.0-rc.1"];
    expect(highestRelease(published)).toBe("1.10.0");
    expect(checkVersion("1.9.5", published).ok).toBe(false);
    expect(checkVersion("1.10.0", published).ok).toBe(false);
    expect(checkVersion("1.10.1", published).ok).toBe(true);
  });

  it("refuses a requested version that is not strict x.y.z", () => {
    expect(checkVersion("1.0.0-rc.1", null).ok).toBe(false);
    expect(checkVersion("v1.0.0", []).ok).toBe(false);
  });
});

describe("parseNpmView", () => {
  it("reads an array or a single bare version", () => {
    expect(parseNpmView('["0.0.0-stage","1.0.0"]', true)).toEqual(["0.0.0-stage", "1.0.0"]);
    expect(parseNpmView('"0.0.0-stage"', true)).toEqual(["0.0.0-stage"]);
  });

  it("returns null for E404", () => {
    expect(parseNpmView('{"error":{"code":"E404","summary":"Not Found"}}', false)).toBeNull();
  });

  it("fails closed on other errors and unreadable output", () => {
    expect(() => parseNpmView('{"error":{"code":"ETIMEDOUT"}}', false)).toThrow("ETIMEDOUT");
    expect(() => parseNpmView("", false)).toThrow("not JSON");
    expect(() => parseNpmView('{"a":1}', true)).toThrow("unexpected");
  });
});
