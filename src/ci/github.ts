import {
  type CiContext,
  type CiDetector,
  type CiIo,
  type Env,
  nonEmpty,
  positiveInt,
} from "./types.js";

interface PullRequestEvent {
  number: number | undefined;
  headSha: string | undefined;
}

function readPullRequest(env: Env, io: CiIo): PullRequestEvent {
  const path = nonEmpty(env.GITHUB_EVENT_PATH);
  const text = path === undefined ? undefined : io.readFile(path);
  if (text === undefined) return { number: undefined, headSha: undefined };
  try {
    const event: unknown = JSON.parse(text);
    const pr = (event as { pull_request?: { number?: unknown; head?: { sha?: unknown } } })
      ?.pull_request;
    return {
      number: positiveInt(typeof pr?.number === "number" ? pr.number : undefined),
      headSha: typeof pr?.head?.sha === "string" ? pr.head.sha : undefined,
    };
  } catch {
    return { number: undefined, headSha: undefined };
  }
}

// On a pull_request event GITHUB_SHA is GitHub's test merge commit, which Zof never decided on.
export const github: CiDetector = {
  provider: "github_actions",
  label: "GitHub Actions",
  detect: (env) => env.GITHUB_ACTIONS === "true",
  read(env: Env, io: CiIo): CiContext {
    const repo = nonEmpty(env.GITHUB_REPOSITORY);
    const runId = nonEmpty(env.GITHUB_RUN_ID);
    const server = nonEmpty(env.GITHUB_SERVER_URL)?.replace(/\/+$/, "");
    const pr = readPullRequest(env, io);
    return {
      provider: "github_actions",
      label: "GitHub Actions",
      repo,
      commit: pr.headSha ?? nonEmpty(env.GITHUB_SHA),
      ref: nonEmpty(env.GITHUB_REF),
      pullRequest: pr.number,
      runId,
      runAttempt: positiveInt(env.GITHUB_RUN_ATTEMPT),
      job: nonEmpty(env.GITHUB_JOB),
      runUrl:
        server !== undefined && repo !== undefined && runId !== undefined
          ? `${server}/${repo}/actions/runs/${runId}`
          : undefined,
      environment: undefined,
    };
  },
};
