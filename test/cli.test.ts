import { describe, expect, it } from "vitest";
import { Exit } from "../src/exit.js";
import { DEFAULT_API_URL, runGateCli as main } from "../src/index.js";
import {
  BREAK_GLASS,
  captureIo,
  FIXTURE_ARGS,
  FIXTURE_ENV,
  fakeDeps,
  fixture,
  TOKEN,
} from "./helpers.js";

async function run(args: readonly string[], env: Record<string, string | undefined>) {
  const net = fakeDeps([{ status: 503, body: { code: "unavailable", detail: "x" } }]);
  const out = captureIo();
  const exit = await main(args, env, out.io, net.deps);
  return { exit, sent: net.sent, out };
}

describe("the Control Plane address", () => {
  const TOKEN_ONLY = { ZOF_GATE_TOKEN: FIXTURE_ENV.ZOF_GATE_TOKEN };
  const WAITING = fixture("release-gate-answer-waiting");

  // A waiting answer makes the client poll, so every request the run sends is checked.
  async function runAll(args: readonly string[], env: Record<string, string | undefined>) {
    const net = fakeDeps([
      { status: 202, body: { ...WAITING, poll_after_seconds: 1 } },
      { status: 200, body: fixture("release-gate-answer-pass") },
    ]);
    const out = captureIo();
    const exit = await main(args, env, out.io, net.deps);
    return { exit, sent: net.sent };
  }

  it("is the constant https://control.zof.ai", () => {
    expect(DEFAULT_API_URL).toBe("https://control.zof.ai");
  });

  it.each([
    ["nothing is set", TOKEN_ONLY],
    ["ZOF_API_URL is empty", { ...TOKEN_ONLY, ZOF_API_URL: "  " }],
  ])("is the default when %s, and the token goes only there", async (_, env) => {
    const r = await runAll(FIXTURE_ARGS, env);
    expect(r.exit).toBe(Exit.Pass);
    expect(r.sent.length).toBeGreaterThan(1);
    for (const s of r.sent) {
      expect(new URL(s.url).origin).toBe("https://control.zof.ai");
      expect(s.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    }
  });

  it.each([
    ["ZOF_API_URL", [], { ...TOKEN_ONLY, ZOF_API_URL: "https://cp.example.com" }],
    ["--api-url", ["--api-url", "https://cp.example.com"], TOKEN_ONLY],
    [
      "--api-url over ZOF_API_URL",
      ["--api-url", "https://cp.example.com"],
      { ...TOKEN_ONLY, ZOF_API_URL: "https://other.example.com" },
    ],
  ])("is overridden by %s, and the default host then gets nothing", async (_, extra, env) => {
    const r = await runAll([...FIXTURE_ARGS, ...extra], env);
    expect(r.exit).toBe(Exit.Pass);
    for (const s of r.sent) expect(new URL(s.url).origin).toBe("https://cp.example.com");
  });

  it.each(["http://cp.example.com", "http://control.zof.ai", "ftp://cp.example.com", "not a url"])(
    "refuses a non-https override %s and sends nothing",
    async (url) => {
      for (const [args, env] of [
        [["--api-url", url], TOKEN_ONLY],
        [[], { ...TOKEN_ONLY, ZOF_API_URL: url }],
      ] as const) {
        const r = await runAll([...FIXTURE_ARGS, ...args], env);
        expect(r.exit).toBe(Exit.Usage);
        expect(r.sent).toHaveLength(0);
      }
    },
  );

  it.each(["http://localhost:8000", "http://127.0.0.1:8000", "http://[::1]:8000"])(
    "allows plain http to %s for development",
    async (url) => {
      const r = await runAll([...FIXTURE_ARGS, "--api-url", url], TOKEN_ONLY);
      expect(r.exit).toBe(Exit.Pass);
      for (const s of r.sent) expect(s.url.startsWith(`${url}/`)).toBe(true);
    },
  );
});

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
      "a plain-http API URL",
      { ...FIXTURE_ENV, ZOF_API_URL: "http://cp.example.com" },
      Exit.Usage,
      "ZOF_API_URL or --api-url must be an https URL (http only for localhost).",
    ],
    [
      "an API URL with credentials",
      { ...FIXTURE_ENV, ZOF_API_URL: "https://u:p@cp.example.com" },
      Exit.Usage,
      "ZOF_API_URL or --api-url must be an https URL (http only for localhost).",
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
