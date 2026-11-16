import { describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { Exit } from "../src/exit.js";
import { BREAK_GLASS, captureIo, FIXTURE_ARGS, FIXTURE_ENV, fakeDeps } from "./helpers.js";

async function run(args: readonly string[], env: Record<string, string | undefined>) {
  const net = fakeDeps([{ status: 503, body: { code: "unavailable", detail: "x" } }]);
  const out = captureIo();
  const exit = await main(args, env, out.io, net.deps);
  return { exit, sent: net.sent, out };
}

describe("configuration (nothing is sent)", () => {
  it.each([
    [
      "no token",
      { ZOF_API_URL: "https://cp.example.com" },
      Exit.Usage,
      "ZOF_GATE_TOKEN is not set.",
    ],
    [
      "empty token",
      { ...FIXTURE_ENV, ZOF_GATE_TOKEN: " " },
      Exit.Usage,
      "ZOF_GATE_TOKEN is not set.",
    ],
    [
      "a token of another kind",
      { ...FIXTURE_ENV, ZOF_GATE_TOKEN: "ghp_abcdef" },
      Exit.Token,
      "ZOF_GATE_TOKEN is not a Zof pipeline token (zgt_…).",
    ],
    [
      "no API URL",
      { ZOF_GATE_TOKEN: FIXTURE_ENV.ZOF_GATE_TOKEN },
      Exit.Usage,
      "Set ZOF_API_URL or --api-url to the Control Plane's https URL.",
    ],
    [
      "a plain-http API URL",
      { ...FIXTURE_ENV, ZOF_API_URL: "http://cp.example.com" },
      Exit.Usage,
      "Set ZOF_API_URL or --api-url to the Control Plane's https URL.",
    ],
    [
      "an API URL with credentials",
      { ...FIXTURE_ENV, ZOF_API_URL: "https://u:p@cp.example.com" },
      Exit.Usage,
      "Set ZOF_API_URL or --api-url to the Control Plane's https URL.",
    ],
  ])("%s", async (_, env, exit, line) => {
    const r = await run(FIXTURE_ARGS, env);
    expect(r.exit).toBe(exit);
    expect(r.out.stdout).toContain(line);
    expect(r.sent).toHaveLength(0);
  });

  it.each([
    ["no token", { ...FIXTURE_ENV }, "Payments outage"],
    [
      "a token of another kind",
      { ...FIXTURE_ENV, ZOF_BREAK_GLASS_TOKEN: "zgt_x" },
      "Payments outage",
    ],
    ["a blank reason", { ...FIXTURE_ENV, ZOF_BREAK_GLASS_TOKEN: BREAK_GLASS }, "  "],
    ["a reason over 500", { ...FIXTURE_ENV, ZOF_BREAK_GLASS_TOKEN: BREAK_GLASS }, "x".repeat(501)],
  ])("--break-glass with %s is exit 4 and sends nothing", async (_, env, reason) => {
    const r = await run([...FIXTURE_ARGS, "--break-glass", reason], env);
    expect(r.exit).toBe(Exit.Token);
    expect(r.sent).toHaveLength(0);
  });

  it.each([
    ["--max-wait", "0"],
    ["--max-wait", "61"],
    ["--max-wait", "1.5"],
    ["--bogus", "1"],
  ])("%s %s is a usage error", async (flag, value) => {
    const r = await run([...FIXTURE_ARGS, flag, value], FIXTURE_ENV);
    expect(r.exit).toBe(Exit.Usage);
    expect(r.sent).toHaveLength(0);
  });

  it("a missing value names the flag to pass", async () => {
    const r = await run(["--environment", "production"], FIXTURE_ENV);
    expect(r.exit).toBe(Exit.Usage);
    expect(r.out.stdout).toEqual(["zof-gate: Pass --repo owner/name (the GitHub repo)."]);
  });

  it("--api-url wins over ZOF_API_URL; localhost http is allowed for development", async () => {
    const r = await run([...FIXTURE_ARGS, "--api-url", "http://localhost:8000/"], FIXTURE_ENV);
    expect(r.sent[0]?.url).toBe("http://localhost:8000/v1/gate/checks");
  });

  it("--help exits 0 without a request", async () => {
    const r = await run(["--help"], {});
    expect(r.exit).toBe(Exit.Pass);
    expect(r.sent).toHaveLength(0);
    expect(r.out.stdout.join("\n")).toContain("Exit codes: 0 pass, 1 blocked");
  });
});
