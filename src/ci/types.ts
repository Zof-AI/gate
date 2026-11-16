import type { Provider } from "../contract.js";

export type Env = Readonly<Record<string, string | undefined>>;

export interface CiIo {
  /** Returns the file's text, or undefined when it can't be read. */
  readFile(path: string): string | undefined;
}

/** What a CI tells us about the run; undefined means "not provided, pass a flag". */
export interface CiContext {
  provider: Provider;
  label: string;
  repo: string | undefined;
  commit: string | undefined;
  ref: string | undefined;
  pullRequest: number | undefined;
  runId: string | undefined;
  runAttempt: number | undefined;
  job: string | undefined;
  runUrl: string | undefined;
  environment: string | undefined;
}

/** One module per CI provider; add a provider by adding a detector to `DETECTORS`. */
export interface CiDetector {
  provider: Provider;
  label: string;
  detect(env: Env): boolean;
  read(env: Env, io: CiIo): CiContext;
}

export function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value.trim();
}

export function positiveInt(value: string | number | undefined | null): number | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 1 ? value : undefined;
  }
  const text = nonEmpty(value ?? undefined);
  if (text === undefined || !/^[1-9][0-9]{0,15}$/.test(text)) return undefined;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : undefined;
}

const GITHUB_REMOTE = [
  // https://[user[:pass]@]github.com/owner/name[.git][/]  and  ssh://git@github.com/owner/name.git
  /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?github\.com(?::\d+)?\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i,
  // git@github.com:owner/name.git
  /^[^@\s]+@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i,
];

/** `owner/name` only when the remote is github.com; any other host is never guessed from. */
export function githubRepoFromUrl(url: string | undefined): string | undefined {
  const text = nonEmpty(url);
  if (text === undefined) return undefined;
  for (const pattern of GITHUB_REMOTE) {
    const m = pattern.exec(text);
    if (m?.[1] !== undefined && m[2] !== undefined) return `${m[1]}/${m[2]}`;
  }
  return undefined;
}

/** A run link is optional, so an internal plain-http one is dropped rather than failing the job. */
export function httpsUrl(value: string | undefined): string | undefined {
  const text = nonEmpty(value);
  return text !== undefined && /^https:\/\/[\x21-\x7e]+$/.test(text) ? text : undefined;
}

/** The trailing number of a GitHub pull request URL (`…/pull/9`). */
export function pullNumberFromUrl(url: string | undefined): number | undefined {
  const m = /\/pull\/([0-9]+)\/?$/.exec(nonEmpty(url) ?? "");
  return positiveInt(m?.[1]);
}
