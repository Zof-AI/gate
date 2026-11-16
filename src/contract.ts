// The gate.v1 vocabulary this client was built against (Control Plane docs/openapi/gate.v1.json).
// test/contract.test.ts fails when these drift from the copied schemas in fixtures/gate.v1.

export const SCHEMA_VERSION = 1;
export const CONTRACT = "gate.v1";
export const CONTRACT_REVISION = "1.2";

export const PROVIDERS = [
  "github_actions",
  "gitlab_ci",
  "bitbucket",
  "azure_pipelines",
  "jenkins",
  "circleci",
  "other",
] as const;
export type Provider = (typeof PROVIDERS)[number];

export const GATE_STATES = ["waiting", "final"] as const;
export type GateState = (typeof GATE_STATES)[number];

export const GATE_RESULTS = ["waiting", "pass", "fail"] as const;
export type GateResult = (typeof GATE_RESULTS)[number];

export const BASES = ["decision", "baseline", "break_glass"] as const;
export type Basis = (typeof BASES)[number];

export const FAILURE_CODES = [
  "denied",
  "not_waitable",
  "evidence_timeout",
  "approval_timeout",
  "decision_timeout",
  "change_closed",
  "repo_inactive",
  "stale_decision",
  "action_expired",
  "action_already_used",
  "authorization_invalid",
  "gate_expired",
] as const;

export const ERROR_CODES = [
  "unauthorized",
  "token_expired",
  "insufficient_scope",
  "gate_not_enabled",
  "company_unbound",
  "environment_not_allowed",
  "break_glass_not_allowed",
  "repo_not_found",
  "not_found",
  "commit_unknown",
  "commit_ambiguous",
  "idempotency_conflict",
  "payload_too_large",
  "idempotency_key_required",
  "invalid_body",
  "unknown_environment",
  "rate_limited",
  "unavailable",
  "policy_lagging",
  "verification_unavailable",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const REPO_PATTERN = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
export const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
export const ENVIRONMENT_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;
export const PRINTABLE_PATTERN = /^[\x21-\x7e]+$/;
export const GATE_ID_PATTERN = /^gate_[0-9a-f]{32}$/;
export const RUN_URL_PATTERN = /^https:\/\/[\x21-\x7e]+$/;
export const IDEMPOTENCY_KEY_MAX = 200;
export const RUN_ID_MAX = 128;
export const JOB_MAX = 100;
export const REF_MAX = 255;
export const RUN_URL_MAX = 2048;
export const BREAK_GLASS_REASON_MAX = 500;
export const LONG_POLL_MAX_SECONDS = 20;

export interface GatePipeline {
  provider: Provider;
  run_id: string;
  run_attempt: number;
  job: string;
  run_url: string | null;
}

export interface GateRequest {
  schema_version: typeof SCHEMA_VERSION;
  repo: string;
  commit_sha: string;
  ref: string | null;
  pull_request: number | null;
  environment: string;
  pipeline: GatePipeline;
  break_glass_reason: string | null;
}

export interface GateReason {
  code: string;
  requirement_key: string | null;
  message: string;
  remedy: string | null;
}

export interface GateFailure {
  code: string;
  message: string;
}

export interface GateAnswer {
  schema_version: typeof SCHEMA_VERSION;
  kind: "gate_check";
  gate_id: string;
  tenant_id: string;
  change_id: string | null;
  correlation_id: string;
  repo: string;
  commit_sha: string;
  environment: string;
  policy_environment: string;
  state: GateState;
  result: GateResult;
  basis: Basis | null;
  verdict: string | null;
  waiting_for: string | null;
  reasons: GateReason[];
  reasons_total: number;
  failure: GateFailure | null;
  decision_id: string | null;
  inputs_hash: string | null;
  authorization_id: string | null;
  console_url: string | null;
  approve_url: string | null;
  wait_until: string;
  poll_after_seconds: number | null;
  answered_at: string;
}

export interface GateError {
  code: string;
  detail: string;
}
