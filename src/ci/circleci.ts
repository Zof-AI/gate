import {
  type CiContext,
  type CiDetector,
  type Env,
  githubRepoFromUrl,
  httpsUrl,
  nonEmpty,
  positiveInt,
  pullNumberFromUrl,
} from "./types.js";

// CircleCI also builds Bitbucket and GitLab projects; only a github.com remote names our repo.
export const circleci: CiDetector = {
  provider: "circleci",
  label: "CircleCI",
  detect: (env) => env.CIRCLECI === "true",
  read(env: Env): CiContext {
    const onGithub = githubRepoFromUrl(env.CIRCLE_REPOSITORY_URL) !== undefined;
    const owner = nonEmpty(env.CIRCLE_PROJECT_USERNAME);
    const name = nonEmpty(env.CIRCLE_PROJECT_REPONAME);
    return {
      provider: "circleci",
      label: "CircleCI",
      repo: onGithub && owner !== undefined && name !== undefined ? `${owner}/${name}` : undefined,
      commit: nonEmpty(env.CIRCLE_SHA1),
      ref: nonEmpty(env.CIRCLE_BRANCH) ?? nonEmpty(env.CIRCLE_TAG),
      pullRequest: onGithub ? pullNumberFromUrl(env.CIRCLE_PULL_REQUEST) : undefined,
      runId: nonEmpty(env.CIRCLE_WORKFLOW_ID),
      // A rerun job gets a new build number, so it serves as the attempt.
      runAttempt: positiveInt(env.CIRCLE_BUILD_NUM),
      job: nonEmpty(env.CIRCLE_JOB),
      runUrl: httpsUrl(env.CIRCLE_BUILD_URL),
      environment: undefined,
    };
  },
};
