import {
  BASES,
  type Basis,
  GATE_ID_PATTERN,
  GATE_RESULTS,
  GATE_STATES,
  type GateAnswer,
  type GateError,
  type GateFailure,
  type GateReason,
  type GateRequest,
  type GateResult,
  type GateState,
  SCHEMA_VERSION,
} from "./contract.js";

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

type Json = Record<string, unknown>;

class Invalid extends Error {}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(obj: Json, key: string): string {
  const v = obj[key];
  if (typeof v !== "string") throw new Invalid(`${key} is not a string`);
  return v;
}

function strOrNull(obj: Json, key: string): string | null {
  if (!(key in obj)) throw new Invalid(`${key} is missing`);
  const v = obj[key];
  if (v === null) return null;
  if (typeof v !== "string") throw new Invalid(`${key} is not a string or null`);
  return v;
}

function oneOf<T extends string>(obj: Json, key: string, allowed: readonly T[]): T {
  const v = str(obj, key);
  if (!(allowed as readonly string[]).includes(v)) throw new Invalid(`${key} is not recognised`);
  return v as T;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidOrNull(obj: Json, key: string): string | null {
  const v = strOrNull(obj, key);
  if (v !== null && !UUID.test(v)) throw new Invalid(`${key} is not a UUID`);
  return v;
}

function date(obj: Json, key: string): string {
  const v = str(obj, key);
  if (Number.isNaN(Date.parse(v))) throw new Invalid(`${key} is not a date-time`);
  return v;
}

function reason(value: unknown): GateReason {
  if (!isObject(value)) throw new Invalid("a reason is not an object");
  return {
    code: str(value, "code"),
    requirement_key: strOrNull(value, "requirement_key"),
    message: str(value, "message"),
    // Display only: a remedy added in a later contract revision must not become an outage.
    remedy: strOrNull(value, "remedy"),
  };
}

function failure(obj: Json): GateFailure | null {
  if (!("failure" in obj)) throw new Invalid("failure is missing");
  const value = obj.failure;
  if (value === null) return null;
  if (!isObject(value)) throw new Invalid("failure is not an object");
  return { code: str(value, "code"), message: str(value, "message") };
}

function answerFrom(raw: unknown): GateAnswer {
  if (!isObject(raw)) throw new Invalid("the answer is not a JSON object");
  if (raw.schema_version !== SCHEMA_VERSION) throw new Invalid("schema_version is not 1");
  if (raw.kind !== "gate_check") throw new Invalid("kind is not gate_check");
  const gateId = str(raw, "gate_id");
  if (!GATE_ID_PATTERN.test(gateId)) throw new Invalid("gate_id is malformed");

  const state = oneOf<GateState>(raw, "state", GATE_STATES);
  const result = oneOf<GateResult>(raw, "result", GATE_RESULTS);
  const basisRaw = raw.basis;
  if (basisRaw !== null && !(typeof basisRaw === "string" && BASES.includes(basisRaw as Basis))) {
    throw new Invalid("basis is not recognised");
  }
  const reasonsRaw = raw.reasons;
  if (!Array.isArray(reasonsRaw)) throw new Invalid("reasons is not a list");
  const total = raw.reasons_total;
  if (typeof total !== "number" || !Number.isInteger(total) || total < 0) {
    throw new Invalid("reasons_total is not a count");
  }
  const poll = raw.poll_after_seconds;
  if (poll !== null && (typeof poll !== "number" || !Number.isInteger(poll) || poll < 0)) {
    throw new Invalid("poll_after_seconds is not a whole number of seconds");
  }

  return {
    schema_version: SCHEMA_VERSION,
    kind: "gate_check",
    gate_id: gateId,
    tenant_id: str(raw, "tenant_id"),
    change_id: strOrNull(raw, "change_id"),
    correlation_id: str(raw, "correlation_id"),
    repo: str(raw, "repo"),
    commit_sha: str(raw, "commit_sha"),
    environment: str(raw, "environment"),
    policy_environment: str(raw, "policy_environment"),
    state,
    result,
    basis: basisRaw as Basis | null,
    verdict: strOrNull(raw, "verdict"),
    waiting_for: strOrNull(raw, "waiting_for"),
    reasons: reasonsRaw.map(reason),
    reasons_total: total,
    failure: failure(raw),
    decision_id: uuidOrNull(raw, "decision_id"),
    inputs_hash: strOrNull(raw, "inputs_hash"),
    authorization_id: uuidOrNull(raw, "authorization_id"),
    console_url: strOrNull(raw, "console_url"),
    approve_url: strOrNull(raw, "approve_url"),
    wait_until: date(raw, "wait_until"),
    poll_after_seconds: poll,
    answered_at: date(raw, "answered_at"),
  };
}

// The rules that decide the exit are strict; a pass that breaks any of them is not a pass.
function checkConsistent(a: GateAnswer): void {
  if ((a.state === "waiting") !== (a.result === "waiting")) {
    throw new Invalid("state and result disagree");
  }
  if (a.result === "fail" && a.failure === null) throw new Invalid("a fail has no failure");
  if (a.result !== "fail" && a.failure !== null) throw new Invalid("failure set on a non-fail");
  if (a.result === "pass" && a.basis === null) throw new Invalid("a pass has no basis");
  if (a.result !== "pass" && a.basis !== null) throw new Invalid("basis set on a non-pass");
  if (a.basis === "decision") {
    if (a.verdict !== "allow") throw new Invalid("a decision pass without an allow verdict");
    if (a.authorization_id === null || a.decision_id === null) {
      throw new Invalid("a decision pass without its decision and authorization");
    }
  }
}

/**
 * Parses a gate.v1 answer. Unknown extra fields and display-only values (remedy, reason and
 * failure codes, verdict, waiting_for) are tolerated so an additive contract change is not an
 * outage; none of them can turn a non-pass into a pass.
 */
export function parseAnswer(raw: unknown): Parsed<GateAnswer> {
  try {
    const answer = answerFrom(raw);
    checkConsistent(answer);
    return { ok: true, value: answer };
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, error: err.message };
    throw err;
  }
}

/** An answer must be about what we asked: same call, repo, commit and environment (§3.6). */
export function mismatch(
  answer: GateAnswer,
  request: GateRequest,
  gateId: string | null,
): string | null {
  if (gateId !== null && answer.gate_id !== gateId) return "gate_id";
  if (answer.repo.toLowerCase() !== request.repo.toLowerCase()) return "repo";
  if (answer.commit_sha !== request.commit_sha) return "commit_sha";
  if (answer.environment !== request.environment) return "environment";
  if (answer.basis === "break_glass" && request.break_glass_reason === null) return "basis";
  return null;
}

export function parseError(raw: unknown): GateError | null {
  if (!isObject(raw)) return null;
  const { code, detail } = raw;
  if (typeof code !== "string" || typeof detail !== "string") return null;
  return { code, detail };
}
