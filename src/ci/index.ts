import { azure } from "./azure.js";
import { bitbucket } from "./bitbucket.js";
import { circleci } from "./circleci.js";
import { github } from "./github.js";
import { gitlab } from "./gitlab.js";
import { jenkins } from "./jenkins.js";
import type { CiContext, CiDetector, CiIo, Env } from "./types.js";

export type { CiContext, CiDetector, CiIo, Env } from "./types.js";

export const DETECTORS: readonly CiDetector[] = [
  github,
  gitlab,
  bitbucket,
  azure,
  jenkins,
  circleci,
];

const OTHER: CiContext = {
  provider: "other",
  label: "CI",
  repo: undefined,
  commit: undefined,
  ref: undefined,
  pullRequest: undefined,
  runId: undefined,
  runAttempt: undefined,
  job: undefined,
  runUrl: undefined,
  environment: undefined,
};

/** The first detector that recognises the environment reads it; otherwise every value is a flag. */
export function detectCi(env: Env, io: CiIo): CiContext {
  const detector = DETECTORS.find((d) => d.detect(env));
  return detector === undefined ? OTHER : detector.read(env, io);
}
