import { type CiContext, type CiDetector, type Env, nonEmpty, positiveInt } from "./types.js";

// CI_PROJECT_PATH names the GitLab project, never the GitHub repo Zof gates, so --repo is required.
// CI_MERGE_REQUEST_IID numbers a GitLab merge request, not a GitHub pull request, so --pr stays a flag.
export const gitlab: CiDetector = {
  provider: "gitlab_ci",
  label: "GitLab CI",
  detect: (env) => env.GITLAB_CI === "true",
  read(env: Env): CiContext {
    return {
      provider: "gitlab_ci",
      label: "GitLab CI",
      repo: undefined,
      commit: nonEmpty(env.CI_COMMIT_SHA),
      ref: nonEmpty(env.CI_COMMIT_REF_NAME),
      pullRequest: undefined,
      runId: nonEmpty(env.CI_PIPELINE_ID),
      // A retried GitLab job gets a new CI_JOB_ID, so it serves as the attempt.
      runAttempt: positiveInt(env.CI_JOB_ID),
      job: nonEmpty(env.CI_JOB_NAME),
      runUrl: nonEmpty(env.CI_JOB_URL),
      environment: nonEmpty(env.CI_ENVIRONMENT_NAME),
    };
  },
};
