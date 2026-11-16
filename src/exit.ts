import type { ErrorCode } from "./contract.js";

// Spec §3.6/§8: every code but Pass fails the job; 3 always means "Zof unavailable".
export const Exit = {
  Pass: 0,
  Blocked: 1,
  Usage: 2,
  Unavailable: 3,
  Token: 4,
} as const;
export type ExitCode = (typeof Exit)[keyof typeof Exit];

export type ErrorDisposition = { kind: "exit"; exit: ExitCode } | { kind: "retry" };

const BY_CODE: Record<ErrorCode, ErrorDisposition> = {
  unauthorized: { kind: "exit", exit: Exit.Token },
  token_expired: { kind: "exit", exit: Exit.Token },
  insufficient_scope: { kind: "exit", exit: Exit.Token },
  gate_not_enabled: { kind: "exit", exit: Exit.Token },
  company_unbound: { kind: "exit", exit: Exit.Token },
  environment_not_allowed: { kind: "exit", exit: Exit.Token },
  break_glass_not_allowed: { kind: "exit", exit: Exit.Token },
  repo_not_found: { kind: "exit", exit: Exit.Usage },
  not_found: { kind: "exit", exit: Exit.Usage },
  commit_unknown: { kind: "exit", exit: Exit.Blocked },
  commit_ambiguous: { kind: "exit", exit: Exit.Usage },
  idempotency_conflict: { kind: "exit", exit: Exit.Usage },
  payload_too_large: { kind: "exit", exit: Exit.Usage },
  idempotency_key_required: { kind: "exit", exit: Exit.Usage },
  invalid_body: { kind: "exit", exit: Exit.Usage },
  unknown_environment: { kind: "exit", exit: Exit.Usage },
  rate_limited: { kind: "retry" },
  unavailable: { kind: "retry" },
  policy_lagging: { kind: "retry" },
  verification_unavailable: { kind: "retry" },
};

function isErrorCode(code: string): code is ErrorCode {
  return Object.hasOwn(BY_CODE, code);
}

/** What to do with a non-answer HTTP status; `code` is null when the body wasn't a GateError. */
export function dispositionFor(status: number, code: string | null): ErrorDisposition {
  if (status === 429 || status >= 500) {
    return { kind: "retry" };
  }
  if (code !== null && isErrorCode(code)) {
    return BY_CODE[code];
  }
  // An unknown code from a newer server still fails closed, classed by its status.
  if (code !== null) {
    if (status === 401 || status === 403) return { kind: "exit", exit: Exit.Token };
    if (status >= 400 && status < 500) return { kind: "exit", exit: Exit.Usage };
  }
  return { kind: "exit", exit: Exit.Unavailable };
}
