import { describe, expect, it } from "vitest";
import { DETECTORS, detectCi } from "../src/ci/index.js";
import { buildRequest, idempotencyKey, normaliseJob } from "../src/request.js";

const SHA = "1a2b3c4d5e6f708192a3b4c5d6e7f80912345678";
const HEAD = "fedcba9876543210fedcba9876543210fedcba98";
const noFiles = { readFile: () => undefined };

// Recorded from real runs, trimmed to the keys we read plus some noise.
const GITHUB_PUSH = {
  CI: "true",
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "example-org/shop",
  GITHUB_SHA: SHA,
  GITHUB_REF: "refs/heads/main",
  GITHUB_RUN_ID: "1234567890",
  GITHUB_RUN_ATTEMPT: "2",
  GITHUB_JOB: "deploy",
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_EVENT_NAME: "push",
  GITHUB_EVENT_PATH: "/home/runner/work/_temp/_github_workflow/event.json",
};

const GITLAB_MR = {
  CI: "true",
  GITLAB_CI: "true",
  CI_PROJECT_PATH: "example-group/shop",
  CI_COMMIT_SHA: SHA,
  CI_COMMIT_REF_NAME: "main",
  CI_MERGE_REQUEST_IID: "17",
  CI_PIPELINE_ID: "998877",
  CI_JOB_ID: "5544332211",
  CI_JOB_NAME: "deploy prod",
  CI_JOB_URL: "https://gitlab.com/example-group/shop/-/jobs/5544332211",
  CI_ENVIRONMENT_NAME: "Production",
};

describe("detection", () => {
  it("has one detector per provider", () => {
    expect(DETECTORS.map((d) => d.provider)).toEqual(["github_actions", "gitlab_ci"]);
  });

  it("falls back to other with nothing detected", () => {
    expect(detectCi({ CI: "true" }, noFiles)).toMatchObject({ provider: "other", repo: undefined });
  });
});

describe("GitHub Actions", () => {
  it("reads a push run", () => {
    expect(detectCi(GITHUB_PUSH, noFiles)).toEqual({
      provider: "github_actions",
      label: "GitHub Actions",
      repo: "example-org/shop",
      commit: SHA,
      ref: "refs/heads/main",
      pullRequest: undefined,
      runId: "1234567890",
      runAttempt: 2,
      job: "deploy",
      runUrl: "https://github.com/example-org/shop/actions/runs/1234567890",
      environment: undefined,
    });
  });

  it("uses the pull request's head, not GitHub's merge commit", () => {
    const event = JSON.stringify({ pull_request: { number: 42, head: { sha: HEAD } } });
    const ci = detectCi(
      { ...GITHUB_PUSH, GITHUB_EVENT_NAME: "pull_request" },
      { readFile: (p) => (p === GITHUB_PUSH.GITHUB_EVENT_PATH ? event : undefined) },
    );
    expect(ci.commit).toBe(HEAD);
    expect(ci.pullRequest).toBe(42);
  });

  it("an unreadable event falls back to GITHUB_SHA", () => {
    const ci = detectCi(GITHUB_PUSH, { readFile: () => "{not json" });
    expect(ci.commit).toBe(SHA);
  });

  it("environment is a flag only, and the key comes from the run", () => {
    const ci = detectCi(GITHUB_PUSH, noFiles);
    expect(buildRequest({}, ci)).toEqual({ ok: false, error: "Pass --environment." });
    const built = buildRequest({ environment: "Production" }, ci);
    if (!built.ok) throw new Error(built.error);
    expect(built.request.environment).toBe("production");
    expect(built.key).toBe("github_actions:1234567890:2:deploy:production");
  });
});

describe("GitLab CI", () => {
  it("reads a merge request pipeline", () => {
    expect(detectCi(GITLAB_MR, noFiles)).toEqual({
      provider: "gitlab_ci",
      label: "GitLab CI",
      repo: undefined,
      commit: SHA,
      ref: "main",
      pullRequest: undefined,
      runId: "998877",
      runAttempt: 5544332211,
      job: "deploy prod",
      runUrl: "https://gitlab.com/example-group/shop/-/jobs/5544332211",
      environment: "Production",
    });
  });

  it("requires --repo, never guessing it from the GitLab project", () => {
    const ci = detectCi(GITLAB_MR, noFiles);
    expect(buildRequest({}, ci)).toEqual({
      ok: false,
      error: "Pass --repo owner/name (the GitHub repo).",
    });
    const built = buildRequest({ repo: "example-org/shop" }, ci);
    if (!built.ok) throw new Error(built.error);
    expect(built.request.environment).toBe("production");
    expect(built.request.pull_request).toBeNull();
    expect(built.request.pipeline.job).toBe("deploy-prod");
    expect(built.key).toBe("gitlab_ci:998877:5544332211:deploy-prod:production");
  });
});

describe("request building", () => {
  const base = { ...GITHUB_PUSH };

  it.each([
    [{ environment: "prod eu" }, "--environment must be lower-case letters, digits and dashes."],
    [{ environment: "p", commit: "abc123" }, "--commit must be a full 40-character commit SHA."],
    [{ environment: "p", repo: "not a repo" }, "--repo must look like owner/name."],
    [{ environment: "p", pr: "0" }, "--pr must be a pull request number."],
    [{ environment: "p", runUrl: "http://x" }, "--run-url must be an https URL."],
    [
      { environment: "p", runId: "has space" },
      "--run-id must be 1-128 printable characters without spaces.",
    ],
  ])("rejects %j", (flags, error) => {
    expect(buildRequest(flags, detectCi(base, noFiles))).toEqual({ ok: false, error });
  });

  it("flags override detection, and the commit is lower-cased", () => {
    const built = buildRequest(
      { environment: "uat", commit: HEAD.toUpperCase(), pr: "7", repo: "o/r" },
      detectCi(base, noFiles),
    );
    if (!built.ok) throw new Error(built.error);
    expect(built.request).toMatchObject({ repo: "o/r", commit_sha: HEAD, pull_request: 7 });
  });

  it("an over-long key is hashed, deterministically and within 200 printable characters", () => {
    const built = buildRequest(
      { environment: "e".repeat(63), runId: "r".repeat(128) },
      detectCi({ ...base, GITHUB_JOB: "j".repeat(100) }, noFiles),
    );
    if (!built.ok) throw new Error(built.error);
    expect(built.key).toMatch(/^github_actions:sha256:[0-9a-f]{64}$/);
    expect(idempotencyKey(built.request)).toBe(built.key);
  });

  it("normalises job names to printable ASCII", () => {
    expect(normaliseJob("deploy → prod")).toBe("deploy-prod");
    expect(normaliseJob("   ")).toBe("zof-gate");
    expect(normaliseJob("x".repeat(150))).toHaveLength(100);
  });
});
