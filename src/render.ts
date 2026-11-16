import type { CiContext } from "./ci/index.js";
import type { GateAnswer, GateRequest } from "./contract.js";

const WAITING: Record<string, string> = {
  decision: "Waiting for Zof's decision",
  evidence: "Waiting for evidence",
  approval: "Waiting for approval",
};

export function headline(request: GateRequest, ci: CiContext): string {
  const run = `${ci.label} run ${request.pipeline.run_id}`;
  return `Zof gate: ${request.repo} @ ${request.commit_sha.slice(0, 7)} → ${request.environment} (${run})`;
}

// A long list buries the first fix in the job log; the console has the rest.
export const MAX_REASONS = 10;

/** One line per CP reason (message and code only), capped, with the remainder counted. */
export function reasonLines(answer: GateAnswer): string[] {
  const shown = answer.reasons.slice(0, MAX_REASONS);
  const lines = shown.map((r) => `  - ${r.message} (${r.code})`);
  const more = Math.max(answer.reasons_total, answer.reasons.length) - shown.length;
  if (more > 0) lines.push(`  +${more} more`);
  return lines;
}

const TIMED_OUT: Record<string, string> = {
  evidence: "Timed out waiting for evidence.",
  approval: "Timed out waiting for approval.",
};

export function timedOutMessage(waitingFor: string | null): string {
  return TIMED_OUT[waitingFor ?? ""] ?? "Timed out waiting for Zof's decision.";
}

export function waitingLines(answer: GateAnswer): string[] {
  const head = WAITING[answer.waiting_for ?? ""] ?? "Waiting";
  const lines = [`${head} · until ${answer.wait_until}`, ...reasonLines(answer)];
  if (answer.approve_url !== null) lines.push(`Approve: ${answer.approve_url}`);
  return lines;
}

export function finalLines(answer: GateAnswer, passed: boolean): string[] {
  const lines: string[] = [];
  if (passed) {
    const basis =
      answer.basis === "baseline"
        ? "this commit is the environment's baseline"
        : answer.basis === "break_glass"
          ? "break-glass, recorded as deployed without a Zof decision"
          : "the deploy decision is ALLOW";
    lines.push(`Passed: ${basis}.`);
  } else {
    const verdict =
      answer.verdict === null ? "" : ` The deploy decision is ${answer.verdict.toUpperCase()}.`;
    lines.push(`Blocked: ${answer.failure?.message ?? "Zof did not allow this deploy."}${verdict}`);
    lines.push(...reasonLines(answer));
  }
  if (answer.console_url !== null) lines.push(`See ${answer.console_url}`);
  return lines;
}
