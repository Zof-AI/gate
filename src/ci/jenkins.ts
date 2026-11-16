import {
  type CiContext,
  type CiDetector,
  type Env,
  githubRepoFromUrl,
  httpsUrl,
  nonEmpty,
  positiveInt,
} from "./types.js";

// CHANGE_ID is a pull request number only for a GitHub branch source, so it follows the remote.
export const jenkins: CiDetector = {
  provider: "jenkins",
  label: "Jenkins",
  detect: (env) => nonEmpty(env.JENKINS_URL) !== undefined,
  read(env: Env): CiContext {
    const repo = githubRepoFromUrl(env.GIT_URL);
    return {
      provider: "jenkins",
      label: "Jenkins",
      repo,
      commit: nonEmpty(env.GIT_COMMIT),
      ref: nonEmpty(env.GIT_BRANCH),
      pullRequest: repo !== undefined ? positiveInt(env.CHANGE_ID) : undefined,
      // BUILD_TAG holds the job name, which may contain spaces; the contract allows none.
      runId: nonEmpty(env.BUILD_TAG)?.replace(/\s+/g, "-"),
      // Every rebuild is a new build number, so BUILD_TAG already tells retries apart.
      runAttempt: undefined,
      job: nonEmpty(env.JOB_NAME),
      runUrl: httpsUrl(env.BUILD_URL),
      environment: undefined,
    };
  },
};
