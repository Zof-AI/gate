import { describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { Exit } from "../src/exit.js";
import { createLogger, redact, sanitizeLine } from "../src/redact.js";
import { BREAK_GLASS, captureIo, FIXTURE_ARGS, FIXTURE_ENV, fakeDeps, TOKEN } from "./helpers.js";

describe("redact", () => {
  it.each(["zgt", "zbg", "zdt", "zct"])("removes any %s_ token", (prefix) => {
    const value = `${prefix}_Ab-9_xYz${"q".repeat(30)}`;
    const out = redact(`token=${value}; again:${value}`);
    expect(out).toBe(`token=${prefix}_***; again:${prefix}_***`);
    expect(out).not.toContain(value.slice(4));
  });

  it("removes bearer values and the configured secrets, whatever their shape", () => {
    expect(redact("Authorization: Bearer abc.def")).toBe("Authorization: Bearer ***");
    expect(redact("secret is s3cr3t-value!", ["s3cr3t-value!"])).toBe("secret is ***");
  });

  it("a token split by a terminal escape is still caught", () => {
    const log: string[] = [];
    createLogger((l) => log.push(l), []).line(`x zgt_abc\x1b[0mdef y`);
    expect(log).toEqual(["x zgt_*** y"]);
  });

  it("neutralises CI workflow commands and control characters in server text", () => {
    expect(sanitizeLine("::set-output name=x::1")).toBe(" ::set-output name=x::1");
    expect(sanitizeLine("a\rb\u0007c")).toBe("a b c");
  });
});

describe("the token never reaches the output", () => {
  const env = { ...FIXTURE_ENV, ZOF_BREAK_GLASS_TOKEN: BREAK_GLASS };

  async function output(body: unknown, status: number, args: readonly string[] = FIXTURE_ARGS) {
    const net = fakeDeps([{ status, body }]);
    const out = captureIo();
    await main(args, env, out.io, net.deps);
    return out.all();
  }

  it("even when the server echoes it in an error", async () => {
    const all = await output(
      { code: "unauthorized", detail: `bad token ${TOKEN} / ${BREAK_GLASS}` },
      401,
    );
    expect(all).toContain("unauthorized: bad token *** / ***");
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain(BREAK_GLASS);
  });

  it("even when a network error message carries the header", async () => {
    const net = fakeDeps([{ throws: true }]);
    const out = captureIo();
    expect(await main(FIXTURE_ARGS, env, out.io, net.deps)).toBe(Exit.Unavailable);
    expect(out.all()).not.toContain(TOKEN);
  });

  it("even when it is passed as an argument by mistake", async () => {
    const net = fakeDeps([]);
    const out = captureIo();
    expect(await main([...FIXTURE_ARGS, "--token", TOKEN], env, out.io, net.deps)).toBe(Exit.Usage);
    expect(out.all()).not.toContain(TOKEN);
    expect(net.sent).toHaveLength(0);
  });

  it("only GitHub's add-mask command carries it, and only on GitHub Actions", async () => {
    const gh = {
      ...env,
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "example-org/shop",
      GITHUB_SHA: "a".repeat(40),
      GITHUB_RUN_ID: "1",
    };
    const net = fakeDeps([{ status: 401, body: { code: "unauthorized", detail: "x" } }]);
    const out = captureIo();
    await main(["--environment", "prod-eu"], gh, out.io, net.deps);
    expect(out.stdout[0]).toBe(`::add-mask::${TOKEN}`);
    expect(out.stdout.slice(1).join("\n")).not.toContain(TOKEN);
    expect(out.stdout.indexOf(`::add-mask::${TOKEN}`)).toBeLessThan(1);

    const plain = captureIo();
    await main(
      FIXTURE_ARGS,
      env,
      plain.io,
      fakeDeps([{ status: 401, body: { code: "unauthorized", detail: "x" } }]).deps,
    );
    expect(plain.all()).not.toContain("add-mask");
  });
});
