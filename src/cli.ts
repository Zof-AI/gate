import { parseArgs } from "node:util";
import { type CiIo, detectCi, type Env } from "./ci/index.js";
import { GateClient, type GateDeps } from "./client.js";
import type { GateAnswer, GateRequest } from "./contract.js";
import { Exit, type ExitCode } from "./exit.js";
import { createLogger } from "./redact.js";
import { finalLines, headline, waitingLines } from "./render.js";
import { buildRequest } from "./request.js";
import { VERSION } from "./version.js";

export interface CliIo extends CiIo {
  stdout(line: string): void;
  stderr(line: string): void;
  /** Called once a request was built and run, so a wrapper (the Action) can report the answer. */
  outcome?(result: CliOutcome): void;
}

export interface CliOutcome {
  exit: ExitCode;
  request: GateRequest;
  answer: GateAnswer | null;
}

const DEFAULT_MAX_WAIT_MINUTES = 10;
// The action behind a gate call lives one hour (ACTION_TTL), so no wait can usefully be longer.
const MAX_WAIT_MINUTES = 60;
const TOKEN_SHAPE = /^zgt_[A-Za-z0-9_-]+$/;
const BREAK_GLASS_SHAPE = /^zbg_[A-Za-z0-9_-]+$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
// A fixed constant, never built from input, so the token can only go to Zof or an explicit override.
export const DEFAULT_API_URL = "https://control.zof.ai";

export const USAGE = `Usage: zof-gate --environment <name> [options]

Asks Zof whether this commit may deploy to this environment. Exit 0 only on a pass.

Options:
  --environment <name>   target environment (required unless the CI provides one)
  --repo <owner/name>    the GitHub repo (required outside GitHub Actions)
  --commit <sha>         the full commit SHA
  --ref <ref>            the git ref, display only
  --pr <number>          pick a pull request when two share the commit
  --run-id <id>          the CI run's id
  --run-url <url>        a link to the CI run (https)
  --max-wait <minutes>   how long to wait, 1-60 (default 10; the server's limit wins)
  --no-wait              answer once, don't wait
  --break-glass <reason> deploy whatever the verdict, recorded (needs ZOF_BREAK_GLASS_TOKEN)
  --json                 print the final answer as one JSON line on stdout
  --api-url <url>        the Control Plane URL (or ZOF_API_URL; default ${DEFAULT_API_URL})

Environment: ZOF_GATE_TOKEN (required), ZOF_BREAK_GLASS_TOKEN, ZOF_API_URL.
Exit codes: 0 pass, 1 blocked, 2 usage or configuration, 3 Zof unavailable, 4 token.`;

// An unset or blank value means the default; a set one must be https (http only for localhost).
function apiUrl(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") return DEFAULT_API_URL;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "")
    return null;
  const local = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !local) return null;
  return url.toString().replace(/\/+$/, "");
}

/** The whole CLI: returns the exit code; every side effect goes through `io`, `env` and `deps`. */
export async function main(
  argv: readonly string[],
  env: Env,
  io: CliIo,
  deps: GateDeps,
): Promise<ExitCode> {
  const secrets = [env.ZOF_GATE_TOKEN ?? "", env.ZOF_BREAK_GLASS_TOKEN ?? ""];
  let log = createLogger(io.stdout, secrets);
  let args: ReturnType<typeof parse>;
  try {
    args = parse(argv);
  } catch (err) {
    // parseArgs echoes the offending argument, which is user input, so it is redacted too.
    log.line(`zof-gate: ${err instanceof Error ? err.message : "bad arguments"}`);
    log.line("Run zof-gate --help for usage.");
    return Exit.Usage;
  }
  const v = args.values;
  if (v.help === true) {
    log.line(USAGE);
    return Exit.Pass;
  }
  if (v.version === true) {
    log.line(VERSION);
    return Exit.Pass;
  }
  const json = v.json === true;
  if (json) log = createLogger(io.stderr, secrets);

  // §11: break-glass without its token or reason is exit 4 and sends nothing.
  const breakGlassReason = v["break-glass"];
  const breakGlassToken = env.ZOF_BREAK_GLASS_TOKEN?.trim() ?? "";
  if (breakGlassReason !== undefined) {
    if (breakGlassToken === "") {
      log.line("ZOF_BREAK_GLASS_TOKEN is not set; --break-glass needs it.");
      return Exit.Token;
    }
    if (!BREAK_GLASS_SHAPE.test(breakGlassToken)) {
      log.line("ZOF_BREAK_GLASS_TOKEN is not a Zof break-glass token (zbg_…).");
      return Exit.Token;
    }
    if (breakGlassReason.trim() === "" || breakGlassReason.length > 500) {
      log.line("--break-glass needs a reason of 1-500 characters.");
      return Exit.Token;
    }
  }

  const token = env.ZOF_GATE_TOKEN?.trim() ?? "";
  if (token === "") {
    log.line("ZOF_GATE_TOKEN is not set.");
    return Exit.Usage;
  }
  if (!TOKEN_SHAPE.test(token)) {
    log.line("ZOF_GATE_TOKEN is not a Zof pipeline token (zgt_…).");
    return Exit.Token;
  }

  const flagUrl = v["api-url"];
  const url = apiUrl(flagUrl !== undefined && flagUrl.trim() !== "" ? flagUrl : env.ZOF_API_URL);
  if (url === null) {
    log.line("ZOF_API_URL or --api-url must be an https URL (http only for localhost).");
    return Exit.Usage;
  }

  let maxWaitMinutes = DEFAULT_MAX_WAIT_MINUTES;
  if (v["max-wait"] !== undefined) {
    const m = v["max-wait"].trim();
    if (!/^[1-9][0-9]?$/.test(m) || Number(m) > MAX_WAIT_MINUTES) {
      log.line(`--max-wait must be whole minutes from 1 to ${MAX_WAIT_MINUTES}.`);
      return Exit.Usage;
    }
    maxWaitMinutes = Number(m);
  }

  const ci = detectCi(env, io);
  const built = buildRequest(
    {
      environment: v.environment,
      repo: v.repo,
      commit: v.commit,
      ref: v.ref,
      pr: v.pr,
      runId: v["run-id"],
      runUrl: v["run-url"],
      breakGlassReason,
    },
    ci,
  );
  if (!built.ok) {
    log.line(`zof-gate: ${built.error}`);
    return Exit.Usage;
  }

  // Defence in depth on GitHub: secrets are masked already, this covers a token set another way.
  if (ci.provider === "github_actions") {
    const write = json ? io.stderr : io.stdout;
    write(`::add-mask::${token}`);
    if (breakGlassReason !== undefined) write(`::add-mask::${breakGlassToken}`);
  }

  log.line(headline(built.request, ci));
  let lastWaiting = "";
  const client = new GateClient(
    {
      apiUrl: url,
      token,
      breakGlassToken: breakGlassReason === undefined ? null : breakGlassToken,
      request: built.request,
      idempotencyKey: built.key,
      userAgent: `zof-gate/${VERSION} (${ci.provider})`,
      maxWaitMs: maxWaitMinutes * 60_000,
      noWait: v["no-wait"] === true,
    },
    deps,
    {
      answer(answer: GateAnswer) {
        if (answer.state !== "waiting") return;
        const lines = waitingLines(answer).join("\n");
        if (lines !== lastWaiting) log.line(lines);
        lastWaiting = lines;
      },
    },
  );
  const outcome = await client.run();

  if (
    outcome.answer !== null &&
    outcome.answer.state === "final" &&
    outcome.exit !== Exit.Unavailable
  ) {
    log.line(finalLines(outcome.answer, outcome.exit === Exit.Pass).join("\n"));
  } else {
    log.line(outcome.exit === Exit.Blocked ? `Blocked: ${outcome.message}` : outcome.message);
    if (outcome.answer?.console_url) log.line(`See ${outcome.answer.console_url}`);
  }
  if (json && outcome.answer !== null) {
    createLogger(io.stdout, secrets).line(JSON.stringify(outcome.answer));
  }
  io.outcome?.({ exit: outcome.exit, request: built.request, answer: outcome.answer });
  return outcome.exit;
}

function parse(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    strict: true,
    allowPositionals: false,
    options: {
      environment: { type: "string" },
      repo: { type: "string" },
      commit: { type: "string" },
      ref: { type: "string" },
      pr: { type: "string" },
      "run-id": { type: "string" },
      "run-url": { type: "string" },
      "max-wait": { type: "string" },
      "no-wait": { type: "boolean" },
      "break-glass": { type: "string" },
      json: { type: "boolean" },
      "api-url": { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean" },
    },
  });
}
