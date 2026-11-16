import {
  type CiContext,
  type CiDetector,
  type Env,
  httpsUrl,
  nonEmpty,
  positiveInt,
} from "./types.js";

// Only a GitHub-hosted repo names the repo Zof gates; Azure Repos and others need --repo.
// On a PR build BUILD_SOURCEVERSION is the test merge commit, which Zof never decided on.
export const azure: CiDetector = {
  provider: "azure_pipelines",
  label: "Azure Pipelines",
  detect: (env) => env.TF_BUILD?.toLowerCase() === "true",
  read(env: Env): CiContext {
    const onGithub = env.BUILD_REPOSITORY_PROVIDER === "GitHub";
    const collection = nonEmpty(env.SYSTEM_COLLECTIONURI)?.replace(/\/+$/, "");
    const project = nonEmpty(env.SYSTEM_TEAMPROJECT);
    const buildId = nonEmpty(env.BUILD_BUILDID);
    return {
      provider: "azure_pipelines",
      label: "Azure Pipelines",
      repo: onGithub ? nonEmpty(env.BUILD_REPOSITORY_NAME) : undefined,
      commit: nonEmpty(env.SYSTEM_PULLREQUEST_SOURCECOMMITID) ?? nonEmpty(env.BUILD_SOURCEVERSION),
      ref: nonEmpty(env.BUILD_SOURCEBRANCH),
      pullRequest: onGithub ? positiveInt(env.SYSTEM_PULLREQUEST_PULLREQUESTNUMBER) : undefined,
      runId: buildId,
      runAttempt: positiveInt(env.SYSTEM_JOBATTEMPT),
      job: nonEmpty(env.AGENT_JOBNAME),
      runUrl:
        collection !== undefined && project !== undefined && buildId !== undefined
          ? httpsUrl(
              `${collection}/${encodeURIComponent(project)}/_build/results?buildId=${encodeURIComponent(buildId)}`,
            )
          : undefined,
      environment: nonEmpty(env.ENVIRONMENT_NAME),
    };
  },
};
