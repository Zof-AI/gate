import {
  type CiContext,
  type CiDetector,
  type Env,
  githubRepoFromUrl,
  nonEmpty,
  positiveInt,
} from "./types.js";

// Bitbucket Pipelines builds Bitbucket repos, so its repo and PR are only GitHub's when the
// origin is github.com (a mirror); otherwise --repo and --pr stay flags.
export const bitbucket: CiDetector = {
  provider: "bitbucket",
  label: "Bitbucket Pipelines",
  detect: (env) => nonEmpty(env.BITBUCKET_BUILD_NUMBER) !== undefined,
  read(env: Env): CiContext {
    const githubRepo = githubRepoFromUrl(env.BITBUCKET_GIT_HTTP_ORIGIN);
    const fullName = nonEmpty(env.BITBUCKET_REPO_FULL_NAME);
    const build = positiveInt(env.BITBUCKET_BUILD_NUMBER);
    return {
      provider: "bitbucket",
      label: "Bitbucket Pipelines",
      repo: githubRepo,
      commit: nonEmpty(env.BITBUCKET_COMMIT),
      ref: nonEmpty(env.BITBUCKET_BRANCH) ?? nonEmpty(env.BITBUCKET_TAG),
      pullRequest: githubRepo !== undefined ? positiveInt(env.BITBUCKET_PR_ID) : undefined,
      runId: nonEmpty(env.BITBUCKET_PIPELINE_UUID),
      runAttempt: undefined,
      // Steps have no name variable; a rerun step gets a new UUID, so a retry is a new call.
      job: nonEmpty(env.BITBUCKET_STEP_UUID),
      runUrl:
        fullName !== undefined && build !== undefined
          ? `https://bitbucket.org/${fullName}/pipelines/results/${build}`
          : undefined,
      environment: nonEmpty(env.BITBUCKET_DEPLOYMENT_ENVIRONMENT),
    };
  },
};
