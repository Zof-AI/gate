import type { Env } from "./ci/index.js";
import { type CliIo, type CliOutcome, main } from "./cli.js";
import type { GateDeps } from "./client.js";
import { Exit, type ExitCode } from "./exit.js";
import { redact, sanitizeLine } from "./redact.js";

export interface ActionIo extends CliIo {
  appendFile(path: string, text: string): void;
}

const TITLE: Record<ExitCode, string> = {
  [Exit.Pass]: "passed",
  [Exit.Blocked]: "blocked",
  [Exit.Usage]: "configuration error",
  [Exit.Unavailable]: "Zof unavailable",
  [Exit.Token]: "token problem",
};

// Fixed text only: server text never reaches a workflow command.
const ANNOTATION: Record<ExitCode, string | null> = {
  [Exit.Pass]: null,
  [Exit.Blocked]: "Blocked: Zof did not allow this deploy. See the job summary.",
  [Exit.Usage]: "Configuration error: see the step log for the input to fix.",
  [Exit.Unavailable]: "Zof unavailable: no answer, so the deploy is blocked. See the step log.",
  [Exit.Token]: "Token problem: check ZOF_GATE_TOKEN (or the token input). See the step log.",
};

const RESULT: Record<ExitCode, string> = {
  [Exit.Pass]: "pass",
  [Exit.Blocked]: "fail",
  [Exit.Usage]: "error",
  [Exit.Unavailable]: "error",
  [Exit.Token]: "error",
};

const SAFE_URL = /^https:\/\/[A-Za-z0-9\-._~:/?#@!$&'*+,;=%]+$/;

/** GitHub keeps hyphens in input names: `api-url` arrives as `INPUT_API-URL`. */
function input(env: Env, name: string): string | undefined {
  const value = env[`INPUT_${name.toUpperCase()}`]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

function markdown(text: string, secrets: readonly string[]): string {
  return redact(sanitizeLine(text), secrets)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_[\]()|#!~{}+-]/g, "\\$&");
}

function summary(exit: ExitCode, result: CliOutcome | null, secrets: readonly string[]): string {
  const lines = [`## Zof gate: ${TITLE[exit]}`, ""];
  if (result !== null) {
    const { request, answer } = result;
    lines.push(
      "| | |",
      "| --- | --- |",
      `| Repo | \`${request.repo}\` |`,
      `| Commit | \`${request.commit_sha.slice(0, 12)}\` |`,
      `| Environment | \`${request.environment}\` |`,
    );
    if (answer?.verdict)
      lines.push(`| Verdict | ${markdown(answer.verdict.toUpperCase(), secrets)} |`);
    lines.push("");
    if (answer?.failure) lines.push(markdown(answer.failure.message, secrets), "");
    if (answer !== null && exit !== Exit.Pass && answer.reasons.length > 0) {
      for (const r of answer.reasons) lines.push(`- ${markdown(r.message, secrets)}`);
      const more = answer.reasons_total - answer.reasons.length;
      if (more > 0) lines.push(`- and ${more} more`);
      lines.push("");
    }
    const url = answer?.console_url;
    if (url && SAFE_URL.test(url)) lines.push(`[Open in Zof](${url})`, "");
  } else {
    lines.push("The gate didn't send a request. The step log says what to fix.", "");
  }
  return `${lines.join("\n")}\n`;
}

/** The GitHub Action: maps inputs onto the CLI, then reports the answer in the job summary. */
export async function runAction(env: Env, io: ActionIo, deps: GateDeps): Promise<ExitCode> {
  const token = input(env, "token") ?? env.ZOF_GATE_TOKEN;
  // Masked before anything else runs, so no later line can carry it.
  if (token !== undefined && token.trim() !== "") io.stdout(`::add-mask::${token.trim()}`);

  const argv: string[] = [];
  const add = (flag: string, value: string | undefined) => {
    if (value !== undefined) argv.push(flag, value);
  };
  add("--environment", input(env, "environment"));
  add("--api-url", input(env, "api-url"));
  add("--max-wait", input(env, "max-wait"));
  add("--break-glass", input(env, "break-glass"));

  let result: CliOutcome | null = null;
  const cliEnv: Env = { ...env, ZOF_GATE_TOKEN: token, INPUT_TOKEN: undefined };
  const exit = await main(
    argv,
    cliEnv,
    {
      ...io,
      outcome: (r) => {
        result = r;
      },
    },
    deps,
  );

  const secrets = [token ?? "", env.ZOF_BREAK_GLASS_TOKEN ?? ""];
  const annotation = ANNOTATION[exit];
  if (annotation !== null) io.stdout(`::error title=Zof gate::${annotation}`);
  const report = result as CliOutcome | null;
  write(io, env.GITHUB_STEP_SUMMARY, summary(exit, report, secrets));
  const url = report?.answer?.console_url;
  const outputs = [`result=${RESULT[exit]}`, `exit-code=${exit}`];
  if (url && SAFE_URL.test(url)) outputs.push(`console-url=${url}`);
  write(io, env.GITHUB_OUTPUT, `${outputs.join("\n")}\n`);
  return exit;
}

// A report that can't be written never changes the verdict the exit code carries.
function write(io: ActionIo, path: string | undefined, text: string): void {
  if (path === undefined || path.trim() === "") return;
  try {
    io.appendFile(path, text);
  } catch {
    io.stdout("Zof gate: couldn't write the job summary or outputs.");
  }
}
