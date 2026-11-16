import { describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { retryAfterMs } from "../src/client.js";
import { Exit } from "../src/exit.js";
import {
  BREAK_GLASS,
  captureIo,
  FIXTURE_ARGS,
  FIXTURE_ENV,
  fakeDeps,
  fixture,
  type Scripted,
  TOKEN,
} from "./helpers.js";

const START = Date.parse("2026-11-13T10:00:00Z");
const waiting = (over: Record<string, unknown> = {}) => ({
  ...fixture("release-gate-answer-waiting"),
  ...over,
});
const farWaiting = (over: Record<string, unknown> = {}) =>
  waiting({ wait_until: "2026-11-13T12:00:00Z", ...over });

async function run(script: Scripted[], args: readonly string[] = FIXTURE_ARGS, env = FIXTURE_ENV) {
  const net = fakeDeps(script, START);
  const out = captureIo();
  const exit = await main(args, env, out.io, net.deps);
  return { exit, ...net, out };
}

describe("request", () => {
  it("POSTs the body with the token, idempotency key and user agent", async () => {
    const { sent } = await run([{ status: 201, body: fixture("release-gate-answer-pass") }]);
    expect(sent).toHaveLength(1);
    const [post] = sent;
    expect(post?.method).toBe("POST");
    expect(post?.url).toBe("https://cp.example.com/v1/gate/checks");
    expect(post?.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(post?.headers["Idempotency-Key"]).toBe("other:1234567890:1:zof-gate:prod-eu");
    expect(post?.headers["User-Agent"]).toMatch(/^zof-gate\/\d+\.\d+\.\d+ \(other\)$/);
    expect(post?.headers["X-Zof-Break-Glass"]).toBeUndefined();
  });

  it("sends the break-glass header and reason only with --break-glass", async () => {
    const env = { ...FIXTURE_ENV, ZOF_BREAK_GLASS_TOKEN: BREAK_GLASS };
    const args = [...FIXTURE_ARGS, "--break-glass", "Outage"];
    const { sent } = await run(
      [{ status: 201, body: fixture("release-gate-answer-pass-break-glass") }],
      args,
      env,
    );
    expect(sent[0]?.headers["X-Zof-Break-Glass"]).toBe(BREAK_GLASS);
    expect(JSON.parse(sent[0]?.body ?? "{}").break_glass_reason).toBe("Outage");
  });
});

describe("polling", () => {
  it("honours poll_after_seconds and long-polls the gate id", async () => {
    const { exit, sent, sleeps } = await run([
      { status: 202, body: farWaiting({ poll_after_seconds: 7 }) },
      { status: 200, body: fixture("release-gate-answer-pass") },
    ]);
    expect(exit).toBe(Exit.Pass);
    expect(sleeps).toEqual([7_000]);
    expect(sent[1]?.method).toBe("GET");
    expect(sent[1]?.url).toBe(
      "https://cp.example.com/v1/gate/checks/gate_11111111111111111111111111111111?wait=20",
    );
    expect(sent[1]?.headers["Idempotency-Key"]).toBeUndefined();
  });

  it("honours Retry-After when it is longer than poll_after_seconds", async () => {
    const { sleeps } = await run([
      { status: 202, body: farWaiting({ poll_after_seconds: 2 }), headers: { "Retry-After": "9" } },
      { status: 200, body: fixture("release-gate-answer-pass") },
    ]);
    expect(sleeps).toEqual([9_000]);
  });

  it("never polls faster than once a second", async () => {
    const { sleeps } = await run([
      { status: 202, body: farWaiting({ poll_after_seconds: 0 }) },
      { status: 200, body: fixture("release-gate-answer-pass") },
    ]);
    expect(sleeps).toEqual([1_000]);
  });

  it("waits 10 minutes by default, then is blocked", async () => {
    const { exit, elapsed, out } = await run([{ status: 202, body: farWaiting() }]);
    expect(exit).toBe(Exit.Blocked);
    expect(elapsed()).toBe(10 * 60_000);
    expect(out.stdout).toContain("Blocked: Timed out waiting for evidence.");
  });

  it.each([
    ["decision", "Timed out waiting for Zof's decision."],
    ["approval", "Timed out waiting for approval."],
    [null, "Timed out waiting for Zof's decision."],
  ])("the timeout says what it waited for (%s)", async (waitingFor, text) => {
    const { out } = await run([{ status: 202, body: farWaiting({ waiting_for: waitingFor }) }]);
    expect(out.stdout).toContain(`Blocked: ${text}`);
  });

  it("--max-wait shortens the wait", async () => {
    const { exit, elapsed } = await run(
      [{ status: 202, body: farWaiting() }],
      [...FIXTURE_ARGS, "--max-wait", "2"],
    );
    expect(exit).toBe(Exit.Blocked);
    expect(elapsed()).toBe(2 * 60_000);
  });

  it("the long-poll never asks to wait past the deadline", async () => {
    const { sent } = await run(
      [{ status: 202, body: farWaiting() }],
      [...FIXTURE_ARGS, "--max-wait", "1"],
    );
    const waits = sent.slice(1).map((s) => Number(new URL(s.url).searchParams.get("wait")));
    expect(Math.max(...waits)).toBeLessThanOrEqual(20);
    for (const s of sent.slice(1)) {
      const wait = Number(new URL(s.url).searchParams.get("wait"));
      expect(s.at + wait * 1_000).toBeLessThanOrEqual(START + 60_000);
    }
  });

  it("the server's wait_until wins over a longer --max-wait", async () => {
    const { exit, elapsed } = await run(
      [{ status: 202, body: waiting() }],
      [...FIXTURE_ARGS, "--max-wait", "60"],
    );
    expect(exit).toBe(Exit.Blocked);
    // wait_until is 10:30, plus one minute's grace for the server to record its timeout.
    expect(elapsed()).toBe(31 * 60_000);
  });

  it("a final timeout recorded by the server is blocked", async () => {
    const timeout = {
      ...fixture("release-gate-answer-fail"),
      verdict: "require_evidence",
      failure: { code: "evidence_timeout", message: "Evidence did not arrive in time." },
    };
    const { exit } = await run([
      { status: 202, body: farWaiting() },
      { status: 200, body: timeout },
    ]);
    expect(exit).toBe(Exit.Blocked);
  });
});

describe("outages are exit 3, after retries", () => {
  it.each([
    ["503 unavailable", { status: 503, body: { code: "unavailable", detail: "x" } }],
    ["429 rate_limited", { status: 429, body: { code: "rate_limited", detail: "x" } }],
    ["500 html", { status: 500, raw: "<html>oops</html>" }],
    ["network error", { throws: true }],
  ] as const)("%s", async (_, step) => {
    const { exit, sent } = await run([step as Scripted]);
    expect(exit).toBe(Exit.Unavailable);
    expect(sent).toHaveLength(5);
  });

  it("retries honour Retry-After and recover", async () => {
    const { exit, sleeps } = await run([
      {
        status: 503,
        body: { code: "policy_lagging", detail: "x" },
        headers: { "Retry-After": "12" },
      },
      { status: 201, body: fixture("release-gate-answer-pass") },
    ]);
    expect(exit).toBe(Exit.Pass);
    expect(sleeps).toEqual([12_000]);
  });

  it("gives up early when Retry-After is past the deadline", async () => {
    const { exit, sent } = await run([
      {
        status: 503,
        body: { code: "unavailable", detail: "x" },
        headers: { "Retry-After": "3600" },
      },
    ]);
    expect(exit).toBe(Exit.Unavailable);
    expect(sent).toHaveLength(1);
  });

  it.each([
    ["non-JSON 200", { status: 200, raw: "ok" }],
    ["schema-invalid 201", { status: 201, body: { result: "pass" } }],
    ["204", { status: 204, raw: "" }],
    ["302", { status: 302, raw: "" }],
    ["401 html", { status: 401, raw: "<html/>" }],
  ] as const)("%s is exit 3 at once", async (_, step) => {
    const { exit, sent } = await run([step as Scripted]);
    expect(exit).toBe(Exit.Unavailable);
    expect(sent).toHaveLength(1);
  });

  it.each([
    ["gate_id", { gate_id: `gate_${"2".repeat(32)}` }],
    ["repo", { repo: "other-org/shop" }],
    ["commit_sha", { commit_sha: "b".repeat(40) }],
    ["environment", { environment: "staging" }],
  ])("a poll answer with another %s is exit 3", async (_, over) => {
    const { exit } = await run([
      { status: 202, body: farWaiting() },
      { status: 200, body: { ...fixture("release-gate-answer-pass"), ...over } },
    ]);
    expect(exit).toBe(Exit.Unavailable);
  });
});

describe("redirects are never followed", () => {
  const TARGET = "http://evil.example.net/v1/gate/checks";

  it.each([
    ["a POST", [{ redirectTo: TARGET }]],
    ["a poll", [{ status: 202, body: farWaiting() }, { redirectTo: TARGET }]],
  ] as const)(
    "%s redirected elsewhere is exit 3 and no secret reaches the target",
    async (_, script) => {
      const env = { ...FIXTURE_ENV, ZOF_BREAK_GLASS_TOKEN: BREAK_GLASS };
      const args = [...FIXTURE_ARGS, "--break-glass", "Outage"];
      const { exit, sent } = await run(script as unknown as Scripted[], args, env);
      expect(exit).toBe(Exit.Unavailable);
      expect(sent.filter((s) => s.url.startsWith("http://evil.example.net"))).toEqual([]);
      for (const s of sent) expect(s.redirect).toBe("error");
    },
  );

  it("every request asks fetch to refuse redirects", async () => {
    const { sent } = await run([
      { status: 202, body: farWaiting() },
      { status: 200, body: fixture("release-gate-answer-pass") },
    ]);
    expect(sent.map((s) => s.redirect)).toEqual(["error", "error"]);
  });
});

describe("error codes (§3.6)", () => {
  it.each([
    [401, "unauthorized", Exit.Token],
    [401, "token_expired", Exit.Token],
    [403, "insufficient_scope", Exit.Token],
    [403, "gate_not_enabled", Exit.Token],
    [403, "company_unbound", Exit.Token],
    [403, "environment_not_allowed", Exit.Token],
    [403, "break_glass_not_allowed", Exit.Token],
    [404, "repo_not_found", Exit.Usage],
    [404, "not_found", Exit.Usage],
    [409, "commit_unknown", Exit.Blocked],
    [409, "commit_ambiguous", Exit.Usage],
    [409, "idempotency_conflict", Exit.Usage],
    [413, "payload_too_large", Exit.Usage],
    [422, "idempotency_key_required", Exit.Usage],
    [422, "invalid_body", Exit.Usage],
    [422, "unknown_environment", Exit.Usage],
    [403, "some_future_code", Exit.Token],
    [409, "some_future_code", Exit.Usage],
  ])("%i %s exits %i", async (status, code, expected) => {
    const { exit, sent, out } = await run([{ status, body: { code, detail: "Detail text." } }]);
    expect(exit).toBe(expected);
    expect(sent).toHaveLength(1);
    expect(out.stdout.at(-1)).toMatch(new RegExp(`^(Blocked: )?${code}: Detail text\\.$`));
  });
});

describe("Retry-After parsing", () => {
  it("reads seconds and HTTP dates, and ignores junk", () => {
    expect(retryAfterMs("5", START)).toBe(5_000);
    expect(retryAfterMs(new Date(START + 8_000).toUTCString(), START)).toBe(8_000);
    expect(retryAfterMs("soon", START)).toBeNull();
    expect(retryAfterMs(null, START)).toBeNull();
  });
});
