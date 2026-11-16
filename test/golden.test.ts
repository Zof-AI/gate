import { describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { Exit } from "../src/exit.js";
import { captureIo, FIXTURE_ARGS, FIXTURE_ENV, fakeDeps, fixture } from "./helpers.js";

// One golden per CP-1 answer: the exit code and the exact job-log lines a developer reads.
const GOLDEN = [
  {
    name: "release-gate-answer-pass",
    status: 201,
    exit: Exit.Pass,
    log: [
      "Passed: the deploy decision is ALLOW.",
      "See https://console.example.com/releases/pr/chg-1",
    ],
  },
  {
    name: "release-gate-answer-pass-baseline",
    status: 201,
    exit: Exit.Pass,
    log: [
      "Passed: this commit is the environment's baseline.",
      "See https://console.example.com/releases/pr/chg-1",
    ],
  },
  {
    name: "release-gate-answer-fail",
    status: 201,
    exit: Exit.Blocked,
    log: [
      "Blocked: The deploy decision blocks this commit. Fix the reasons listed. The deploy decision is DENY.",
      "  - A required check failed.",
      "See https://console.example.com/releases/pr/chg-1",
    ],
  },
  {
    name: "release-gate-answer-expired",
    status: 200,
    exit: Exit.Blocked,
    log: [
      "Blocked: This pass has expired. Re-run the job to ask again. The deploy decision is ALLOW.",
      "See https://console.example.com/releases/pr/chg-1",
    ],
  },
] as const;

const HEADLINE = "Zof gate: example-org/shop @ aaaaaaa → prod-eu (CI run 1234567890)";

describe("golden answers", () => {
  it.each(GOLDEN)("$name exits $exit", async ({ name, status, exit, log }) => {
    const net = fakeDeps([{ status, body: fixture(name) }]);
    const out = captureIo();
    expect(await main(FIXTURE_ARGS, FIXTURE_ENV, out.io, net.deps)).toBe(exit);
    expect(out.stdout).toEqual([HEADLINE, ...log]);
    expect(net.sent).toHaveLength(1);
  });

  it("a break-glass pass exits 0 only for a break-glass request", async () => {
    const env = { ...FIXTURE_ENV, ZOF_BREAK_GLASS_TOKEN: `zbg_${"B".repeat(43)}` };
    const body = fixture("release-gate-answer-pass-break-glass");

    const asked = fakeDeps([{ status: 201, body }]);
    const out = captureIo();
    const args = [...FIXTURE_ARGS, "--break-glass", "Payments outage"];
    expect(await main(args, env, out.io, asked.deps)).toBe(Exit.Pass);
    expect(out.stdout).toContain(
      "Passed: break-glass, recorded as deployed without a Zof decision.",
    );

    const notAsked = fakeDeps([{ status: 201, body }]);
    expect(await main(FIXTURE_ARGS, env, captureIo().io, notAsked.deps)).toBe(Exit.Unavailable);
  });

  it("waiting then pass: logs the wait once, then passes", async () => {
    const net = fakeDeps([
      { status: 202, body: fixture("release-gate-answer-waiting") },
      { status: 200, body: fixture("release-gate-answer-waiting") },
      { status: 200, body: fixture("release-gate-answer-pass") },
    ]);
    const out = captureIo();
    expect(await main(FIXTURE_ARGS, FIXTURE_ENV, out.io, net.deps)).toBe(Exit.Pass);
    expect(out.stdout).toEqual([
      HEADLINE,
      "Waiting for evidence · until 2026-11-13T10:30:00Z",
      "  - A required check hasn't run yet.",
      "Passed: the deploy decision is ALLOW.",
      "See https://console.example.com/releases/pr/chg-1",
    ]);
  });

  it("--no-wait on a waiting answer is blocked", async () => {
    const net = fakeDeps([{ status: 202, body: fixture("release-gate-answer-waiting") }]);
    const out = captureIo();
    const code = await main([...FIXTURE_ARGS, "--no-wait"], FIXTURE_ENV, out.io, net.deps);
    expect(code).toBe(Exit.Blocked);
    expect(net.sent).toHaveLength(1);
  });

  it("--json prints exactly one GateAnswer line on stdout", async () => {
    const net = fakeDeps([{ status: 201, body: fixture("release-gate-answer-pass") }]);
    const out = captureIo();
    expect(await main([...FIXTURE_ARGS, "--json"], FIXTURE_ENV, out.io, net.deps)).toBe(Exit.Pass);
    expect(out.stdout).toHaveLength(1);
    expect(JSON.parse(out.stdout[0] ?? "")).toEqual(fixture("release-gate-answer-pass"));
    expect(out.stderr[0]).toBe(HEADLINE);
  });
});
