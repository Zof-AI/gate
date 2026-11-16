import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/version.js";

describe("VERSION", () => {
  it("matches package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    expect(VERSION).toBe(pkg.version);
  });

  it("keeps install metadata and the default image label on the released version", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
    const docker = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
    expect(lock.version).toBe(VERSION);
    expect(lock.packages[""].version).toBe(VERSION);
    expect(lock.packages[""].bin).toEqual(pkg.bin);
    expect(docker.match(/^ARG VERSION=(.+)$/m)?.[1]).toBe(VERSION);
  });
});
