import { describe, expect, it } from "vitest";
import { DETECTORS, detectCi } from "../src/ci/index.js";
import { githubRepoFromUrl } from "../src/ci/types.js";
import { buildRequest } from "../src/request.js";

const SHA = "1a2b3c4d5e6f708192a3b4c5d6e7f80912345678";
const HEAD = "fedcba9876543210fedcba9876543210fedcba98";
const noFiles = { readFile: () => undefined };

// Recorded env sets, trimmed to the keys we read plus some noise. Values are examples only.
const BITBUCKET = {
  CI: "true",
  BITBUCKET_BUILD_NUMBER: "321",
  BITBUCKET_REPO_FULL_NAME: "example-team/shop",
  BITBUCKET_GIT_HTTP_ORIGIN: "http://bitbucket.org/example-team/shop",
  BITBUCKET_COMMIT: SHA,
  BITBUCKET_BRANCH: "main",
  BITBUCKET_PR_ID: "12",
  BITBUCKET_PIPELINE_UUID: "{0b1c2d3e-0000-4000-8000-000000000001}",
  BITBUCKET_STEP_UUID: "{9f8e7d6c-0000-4000-8000-000000000002}",
  BITBUCKET_DEPLOYMENT_ENVIRONMENT: "Production",
};

const AZURE_GITHUB_PR = {
  TF_BUILD: "True",
  BUILD_REPOSITORY_PROVIDER: "GitHub",
  BUILD_REPOSITORY_NAME: "example-org/shop",
  BUILD_SOURCEVERSION: SHA,
  SYSTEM_PULLREQUEST_SOURCECOMMITID: HEAD,
  BUILD_SOURCEBRANCH: "refs/pull/42/merge",
  SYSTEM_PULLREQUEST_PULLREQUESTNUMBER: "42",
  BUILD_BUILDID: "7788",
  SYSTEM_JOBATTEMPT: "2",
  AGENT_JOBNAME: "Deploy prod",
  SYSTEM_COLLECTIONURI: "https://dev.azure.com/example-org/",
  SYSTEM_TEAMPROJECT: "Shop Platform",
  ENVIRONMENT_NAME: "prod-eu",
};

const JENKINS = {
  JENKINS_URL: "https://ci.example.com/",
  GIT_URL: "https://github.com/example-org/shop.git",
  GIT_COMMIT: SHA,
  GIT_BRANCH: "origin/main",
  CHANGE_ID: "17",
  BUILD_TAG: "jenkins-shop deploy-55",
  JOB_NAME: "shop/deploy",
  BUILD_URL: "https://ci.example.com/job/shop/job/deploy/55/",
};

const CIRCLE = {
  CI: "true",
  CIRCLECI: "true",
  CIRCLE_REPOSITORY_URL: "git@github.com:example-org/shop.git",
  CIRCLE_PROJECT_USERNAME: "example-org",
  CIRCLE_PROJECT_REPONAME: "shop",
  CIRCLE_SHA1: SHA,
  CIRCLE_BRANCH: "feature/x",
  CIRCLE_PULL_REQUEST: "https://github.com/example-org/shop/pull/9",
  CIRCLE_WORKFLOW_ID: "6b1f0c4e-0000-4000-8000-000000000003",
  CIRCLE_BUILD_NUM: "1201",
  CIRCLE_JOB: "deploy",
  CIRCLE_BUILD_URL: "https://circleci.com/gh/example-org/shop/1201",
};

describe("detectors", () => {
  it("has one detector per provider, in a fixed order", () => {
    expect(DETECTORS.map((d) => d.provider)).toEqual([
      "github_actions",
      "gitlab_ci",
      "bitbucket",
      "azure_pipelines",
      "jenkins",
      "circleci",
    ]);
  });

  it("an unknown CI gives nothing, so every value must come from a flag", () => {
    const ci = detectCi({ CI: "true", BUILDKITE: "true", BUILDKITE_COMMIT: SHA }, noFiles);
    expect(ci.provider).toBe("other");
    expect(buildRequest({ environment: "production" }, ci)).toEqual({
      ok: false,
      error: "Pass --repo owner/name (the GitHub repo).",
    });
    expect(buildRequest({ environment: "production", repo: "o/r" }, ci)).toEqual({
      ok: false,
      error: "Pass --commit <40-character SHA>.",
    });
  });
});

describe("githubRepoFromUrl", () => {
  it.each([
    ["https://github.com/o/r.git", "o/r"],
    ["https://github.com/o/r", "o/r"],
    ["https://x-token:secret@github.com/o/r.git", "o/r"],
    ["git@github.com:o/r.git", "o/r"],
    ["ssh://git@github.com/o/r.git", "o/r"],
    ["https://GitHub.com/o/r/", "o/r"],
  ])("%s is %s", (url, repo) => {
    expect(githubRepoFromUrl(url)).toBe(repo);
  });

  it.each([
    "https://gitlab.com/o/r.git",
    "git@bitbucket.org:o/r.git",
    "https://github.com.evil.example/o/r",
    "https://github.com/o",
    "https://github.com/o/r/extra",
    "not a url",
    undefined,
  ])("never guesses from %s", (url) => {
    expect(githubRepoFromUrl(url)).toBeUndefined();
  });
});

describe("Bitbucket Pipelines", () => {
  it("reads a Bitbucket-hosted run, leaving the GitHub repo and PR to flags", () => {
    expect(detectCi(BITBUCKET, noFiles)).toEqual({
      provider: "bitbucket",
      label: "Bitbucket Pipelines",
      repo: undefined,
      commit: SHA,
      ref: "main",
      pullRequest: undefined,
      runId: "{0b1c2d3e-0000-4000-8000-000000000001}",
      runAttempt: undefined,
      job: "{9f8e7d6c-0000-4000-8000-000000000002}",
      runUrl: "https://bitbucket.org/example-team/shop/pipelines/results/321",
      environment: "Production",
    });
  });

  it("uses the repo and PR when the origin is GitHub", () => {
    const ci = detectCi(
      { ...BITBUCKET, BITBUCKET_GIT_HTTP_ORIGIN: "https://github.com/example-team/shop" },
      noFiles,
    );
    expect(ci.repo).toBe("example-team/shop");
    expect(ci.pullRequest).toBe(12);
  });

  it("a tag build uses the tag as the ref", () => {
    const { BITBUCKET_BRANCH: _, ...tagged } = BITBUCKET;
    expect(detectCi({ ...tagged, BITBUCKET_TAG: "v1.2.0" }, noFiles).ref).toBe("v1.2.0");
  });

  it("builds a full request with --repo", () => {
    const built = buildRequest({ repo: "example-org/shop" }, detectCi(BITBUCKET, noFiles));
    if (!built.ok) throw new Error(built.error);
    expect(built.request.environment).toBe("production");
    expect(built.request.pipeline.provider).toBe("bitbucket");
  });
});

describe("Azure Pipelines", () => {
  it("reads a GitHub PR build, using the PR head rather than the merge commit", () => {
    expect(detectCi(AZURE_GITHUB_PR, noFiles)).toEqual({
      provider: "azure_pipelines",
      label: "Azure Pipelines",
      repo: "example-org/shop",
      commit: HEAD,
      ref: "refs/pull/42/merge",
      pullRequest: 42,
      runId: "7788",
      runAttempt: 2,
      job: "Deploy prod",
      runUrl: "https://dev.azure.com/example-org/Shop%20Platform/_build/results?buildId=7788",
      environment: "prod-eu",
    });
  });

  it("detects TF_BUILD in any case", () => {
    expect(detectCi({ TF_BUILD: "true" }, noFiles).provider).toBe("azure_pipelines");
  });

  it("an Azure Repos build gives no repo or PR", () => {
    const ci = detectCi(
      {
        ...AZURE_GITHUB_PR,
        BUILD_REPOSITORY_PROVIDER: "TfsGit",
        SYSTEM_PULLREQUEST_SOURCECOMMITID: "",
      },
      noFiles,
    );
    expect(ci.repo).toBeUndefined();
    expect(ci.pullRequest).toBeUndefined();
    expect(ci.commit).toBe(SHA);
  });
});

describe("Jenkins", () => {
  it("reads a GitHub multibranch build", () => {
    expect(detectCi(JENKINS, noFiles)).toEqual({
      provider: "jenkins",
      label: "Jenkins",
      repo: "example-org/shop",
      commit: SHA,
      ref: "origin/main",
      pullRequest: 17,
      runId: "jenkins-shop-deploy-55",
      runAttempt: undefined,
      job: "shop/deploy",
      runUrl: "https://ci.example.com/job/shop/job/deploy/55/",
      environment: undefined,
    });
  });

  it("a non-GitHub remote gives no repo or PR, and a plain-http run URL is dropped", () => {
    const ci = detectCi(
      {
        ...JENKINS,
        GIT_URL: "https://git.example.com/shop.git",
        BUILD_URL: "http://ci.internal/job/55/",
      },
      noFiles,
    );
    expect(ci.repo).toBeUndefined();
    expect(ci.pullRequest).toBeUndefined();
    expect(ci.runUrl).toBeUndefined();
  });

  it("environment is a flag only", () => {
    expect(buildRequest({}, detectCi(JENKINS, noFiles))).toEqual({
      ok: false,
      error: "Pass --environment.",
    });
  });
});

describe("CircleCI", () => {
  it("reads a GitHub project build", () => {
    expect(detectCi(CIRCLE, noFiles)).toEqual({
      provider: "circleci",
      label: "CircleCI",
      repo: "example-org/shop",
      commit: SHA,
      ref: "feature/x",
      pullRequest: 9,
      runId: "6b1f0c4e-0000-4000-8000-000000000003",
      runAttempt: 1201,
      job: "deploy",
      runUrl: "https://circleci.com/gh/example-org/shop/1201",
      environment: undefined,
    });
  });

  it("a Bitbucket- or GitLab-hosted project gives no repo or PR", () => {
    const ci = detectCi(
      {
        ...CIRCLE,
        CIRCLE_REPOSITORY_URL: "git@bitbucket.org:example-org/shop.git",
        CIRCLE_PULL_REQUEST: "https://bitbucket.org/example-org/shop/pull-requests/9",
      },
      noFiles,
    );
    expect(ci.repo).toBeUndefined();
    expect(ci.pullRequest).toBeUndefined();
  });

  it("a tag build uses the tag as the ref", () => {
    const { CIRCLE_BRANCH: _, ...tagged } = CIRCLE;
    expect(detectCi({ ...tagged, CIRCLE_TAG: "v2.0.0" }, noFiles).ref).toBe("v2.0.0");
  });
});
