import { createHash } from "node:crypto";
import type { CiContext } from "./ci/index.js";
import {
  BREAK_GLASS_REASON_MAX,
  COMMIT_PATTERN,
  ENVIRONMENT_PATTERN,
  type GateRequest,
  IDEMPOTENCY_KEY_MAX,
  JOB_MAX,
  PRINTABLE_PATTERN,
  REF_MAX,
  REPO_PATTERN,
  RUN_ID_MAX,
  RUN_URL_MAX,
  RUN_URL_PATTERN,
  SCHEMA_VERSION,
} from "./contract.js";

export interface RequestFlags {
  environment?: string | undefined;
  repo?: string | undefined;
  commit?: string | undefined;
  ref?: string | undefined;
  pr?: string | undefined;
  runId?: string | undefined;
  runUrl?: string | undefined;
  breakGlassReason?: string | undefined;
}

export type Built = { ok: true; request: GateRequest; key: string } | { ok: false; error: string };

// A CI with no job name of its own (or none we read) still needs one for the key.
const DEFAULT_JOB = "zof-gate";

/** CI job names may hold spaces or non-ASCII; the contract wants 1-100 printable ASCII. */
export function normaliseJob(job: string): string {
  const clean = job.replace(/[^\x21-\x7e]+/g, "-").replace(/^-+|-+$/g, "");
  return (clean === "" ? DEFAULT_JOB : clean).slice(0, JOB_MAX);
}

/** §3.1: `<provider>:<run_id>:<run_attempt>:<job>:<environment>`, hashed only if over 200. */
export function idempotencyKey(request: GateRequest): string {
  const p = request.pipeline;
  const key = `${p.provider}:${p.run_id}:${p.run_attempt}:${p.job}:${request.environment}`;
  if (key.length <= IDEMPOTENCY_KEY_MAX) return key;
  return `${p.provider}:sha256:${createHash("sha256").update(key).digest("hex")}`;
}

function pick(flag: string | undefined, detected: string | undefined): string | undefined {
  const f = flag?.trim();
  return f !== undefined && f !== "" ? f : detected;
}

/** Merges flags over what the CI provides; a missing value names the flag to pass (exit 2). */
export function buildRequest(flags: RequestFlags, ci: CiContext): Built {
  const environment = pick(flags.environment, ci.environment)?.toLowerCase();
  if (environment === undefined) return { ok: false, error: "Pass --environment." };
  if (!ENVIRONMENT_PATTERN.test(environment)) {
    return { ok: false, error: "--environment must be lower-case letters, digits and dashes." };
  }

  const repo = pick(flags.repo, ci.repo);
  if (repo === undefined) return { ok: false, error: "Pass --repo owner/name (the GitHub repo)." };
  if (!REPO_PATTERN.test(repo)) return { ok: false, error: "--repo must look like owner/name." };

  const commit = pick(flags.commit, ci.commit)?.toLowerCase();
  if (commit === undefined) return { ok: false, error: "Pass --commit <40-character SHA>." };
  if (!COMMIT_PATTERN.test(commit)) {
    return { ok: false, error: "--commit must be a full 40-character commit SHA." };
  }

  const ref = pick(flags.ref, ci.ref) ?? null;
  if (ref !== null && ref.length > REF_MAX) return { ok: false, error: "--ref is too long." };

  let pullRequest: number | null = ci.pullRequest ?? null;
  if (flags.pr !== undefined) {
    if (!/^[1-9][0-9]{0,9}$/.test(flags.pr.trim())) {
      return { ok: false, error: "--pr must be a pull request number." };
    }
    pullRequest = Number(flags.pr.trim());
  }

  const runId = pick(flags.runId, ci.runId);
  if (runId === undefined) return { ok: false, error: "Pass --run-id (the CI run's id)." };
  if (runId.length > RUN_ID_MAX || !PRINTABLE_PATTERN.test(runId)) {
    return { ok: false, error: "--run-id must be 1-128 printable characters without spaces." };
  }

  const runUrl = pick(flags.runUrl, ci.runUrl) ?? null;
  if (runUrl !== null && (runUrl.length > RUN_URL_MAX || !RUN_URL_PATTERN.test(runUrl))) {
    return { ok: false, error: "--run-url must be an https URL." };
  }

  const reason = flags.breakGlassReason ?? null;
  if (reason !== null && (reason.trim() === "" || reason.length > BREAK_GLASS_REASON_MAX)) {
    return { ok: false, error: "--break-glass needs a reason of 1-500 characters." };
  }

  const request: GateRequest = {
    schema_version: SCHEMA_VERSION,
    repo,
    commit_sha: commit,
    ref,
    pull_request: pullRequest,
    environment,
    pipeline: {
      provider: ci.provider,
      run_id: runId,
      run_attempt: ci.runAttempt ?? 1,
      job: normaliseJob(ci.job ?? DEFAULT_JOB),
      run_url: runUrl,
    },
    break_glass_reason: reason,
  };
  return { ok: true, request, key: idempotencyKey(request) };
}

/** The JSON body sent; optional fields are left out rather than sent as null. */
export function requestBody(request: GateRequest): string {
  const { ref, pull_request, break_glass_reason, pipeline, ...rest } = request;
  const { run_url, ...pipe } = pipeline;
  return JSON.stringify({
    ...rest,
    ...(ref === null ? {} : { ref }),
    ...(pull_request === null ? {} : { pull_request }),
    pipeline: { ...pipe, ...(run_url === null ? {} : { run_url }) },
    ...(break_glass_reason === null ? {} : { break_glass_reason }),
  });
}
