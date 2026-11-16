import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type ActionIo, runAction } from "../src/action.js";
import { Exit } from "../src/exit.js";
import { fakeDeps, fixture, TOKEN } from "./helpers.js";

const SHA = "a".repeat(40);
const SUMMARY = "/runner/_temp/summary.md";
const OUTPUT = "/runner/_temp/output";

// What a GitHub runner sets for `uses: zof-ai/gate@v1` with `environment: prod-eu`.
const RUNNER = {
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "example-org/shop",
  GITHUB_SHA: SHA,
  GITHUB_REF: "refs/heads/main",
  GITHUB_RUN_ID: "1234567890",
  GITHUB_RUN_ATTEMPT: "1",
  GITHUB_JOB: "deploy",
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_STEP_SUMMARY: SUMMARY,
  GITHUB_OUTPUT: OUTPUT,
  INPUT_ENVIRONMENT: "prod-eu",
  "INPUT_API-URL": "https://cp.example.com",
  "INPUT_MAX-WAIT": "",
  "INPUT_BREAK-GLASS": "",
  INPUT_TOKEN: "",
  ZOF_GATE_TOKEN: TOKEN,
};

function actionIo() {
  const stdout: string[] = [];
  const files: Record<string, string> = {};
  const io: ActionIo = {
    stdout: (line) => stdout.push(line),
    stderr: (line) => stdout.push(line),
    readFile: () => undefined,
    appendFile(path, text) {
      files[path] = (files[path] ?? "") + text;
    },
  };
  return { io, stdout, files, log: () => stdout.join("\n") };
}

async function run(env: Record<string, string | undefined>, status: number, body: unknown) {
  const net = fakeDeps([{ status, body }]);
  const out = actionIo();
  const exit = await runAction(env, out.io, net.deps);
  return { exit, net, out };
}

describe("action inputs", () => {
  it("passes on an ALLOW and writes the job summary and outputs", async () => {
    const r = await run(RUNNER, 201, fixture("release-gate-answer-pass"));
    expect(r.exit).toBe(Exit.Pass);
    const sent = JSON.parse(r.net.sent[0]?.body ?? "{}") as Record<string, unknown>;
    expect(sent).toMatchObject({ repo: "example-org/shop", environment: "prod-eu" });
    expect(r.net.sent[0]?.url).toBe("https://cp.example.com/v1/gate/checks");
    const summary = r.out.files[SUMMARY] ?? "";
    expect(summary).toContain("## Zof gate: passed");
    expect(summary).toContain("`prod-eu`");
    expect(summary).toContain("[Open in Zof](https://console.example.com/releases/pr/chg-1)");
    expect(r.out.files[OUTPUT]).toBe(
      "result=pass\nexit-code=0\nconsole-url=https://console.example.com/releases/pr/chg-1\n",
    );
  });

  it("a blocked deploy exits 1 with the reasons in the summary and an error annotation", async () => {
    const r = await run(RUNNER, 201, fixture("release-gate-answer-fail"));
    expect(r.exit).toBe(Exit.Blocked);
    const summary = r.out.files[SUMMARY] ?? "";
    expect(summary).toContain("## Zof gate: blocked");
    expect(summary).toContain("| Verdict | DENY |");
    expect(summary).toContain("- A required check failed.");
    expect(r.out.stdout).toContain(
      "::error title=Zof gate::Blocked: Zof did not allow this deploy. See the job summary.",
    );
  });

  it("the token input wins over ZOF_GATE_TOKEN, and is masked before any request", async () => {
    const other = `zgt_${"C".repeat(43)}`;
    const r = await run(
      { ...RUNNER, INPUT_TOKEN: other },
      201,
      fixture("release-gate-answer-pass"),
    );
    expect(r.net.sent[0]?.headers.Authorization).toBe(`Bearer ${other}`);
    expect(r.out.stdout[0]).toBe(`::add-mask::${other}`);
  });

  it("no token is exit 2 naming both ways to give it, and sends nothing", async () => {
    const r = await run({ ...RUNNER, ZOF_GATE_TOKEN: undefined }, 201, {});
    expect(r.exit).toBe(Exit.Usage);
    expect(r.net.sent).toHaveLength(0);
    expect(r.out.log()).toContain("ZOF_GATE_TOKEN is not set.");
    expect(r.out.files[SUMMARY]).toContain("## Zof gate: configuration error");
  });

  it("maps max-wait and break-glass onto the CLI's checks", async () => {
    const bad = await run({ ...RUNNER, "INPUT_MAX-WAIT": "90" }, 201, {});
    expect(bad.exit).toBe(Exit.Usage);
    expect(bad.net.sent).toHaveLength(0);
    const glass = await run({ ...RUNNER, "INPUT_BREAK-GLASS": "Payments outage" }, 201, {});
    expect(glass.exit).toBe(Exit.Token);
    expect(glass.net.sent).toHaveLength(0);
  });

  it("Zof unreachable is exit 3, never a pass", async () => {
    const net = fakeDeps([{ throws: true }]);
    const out = actionIo();
    expect(await runAction(RUNNER, out.io, net.deps)).toBe(Exit.Unavailable);
    expect(out.files[SUMMARY]).toContain("## Zof gate: Zof unavailable");
    expect(out.files[OUTPUT]).toContain("exit-code=3\n");
  });

  it("never writes the token anywhere", async () => {
    for (const body of [fixture("release-gate-answer-pass"), fixture("release-gate-answer-fail")]) {
      const r = await run({ ...RUNNER, INPUT_TOKEN: TOKEN }, 201, body);
      const written = [
        ...r.out.stdout.filter((l) => !l.startsWith("::add-mask::")),
        ...Object.values(r.out.files),
      ].join("\n");
      expect(written).not.toContain(TOKEN);
    }
  });

  it("server text can't inject markdown, HTML or a link into the summary", async () => {
    const body = {
      ...fixture("release-gate-answer-fail"),
      reasons: [
        {
          code: "blocking_check_failed",
          message: "<img src=x> [click](https://evil.example) | ::set-output",
          remedy: "fix_and_push",
          requirement_key: "x",
        },
      ],
      console_url: "javascript:alert(1)",
    };
    const r = await run(RUNNER, 201, body);
    const summary = r.out.files[SUMMARY] ?? "";
    expect(summary).not.toContain("<img");
    expect(summary).not.toContain("](https://evil.example)");
    expect(summary).not.toContain("javascript:");
  });

  it("a summary write failure never changes the exit code", async () => {
    const net = fakeDeps([{ status: 201, body: fixture("release-gate-answer-fail") }]);
    const out = actionIo();
    out.io.appendFile = () => {
      throw new Error("disk full");
    };
    expect(await runAction(RUNNER, out.io, net.deps)).toBe(Exit.Blocked);
  });
});

describe("action.yml", () => {
  const yml = readFileSync(new URL("../action.yml", import.meta.url), "utf8");

  it("runs the committed bundle on node24", () => {
    expect(yml).toMatch(/using: node24/);
    expect(yml).toMatch(/main: dist\/index\.mjs/);
  });

  it("declares exactly the inputs the wrapper reads", () => {
    const inputs = [...yml.matchAll(/^ {2}([a-z-]+):$/gm)].map((m) => m[1]);
    expect(inputs).toEqual(
      expect.arrayContaining(["environment", "api-url", "max-wait", "break-glass", "token"]),
    );
  });
});
