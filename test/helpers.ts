import { readFileSync } from "node:fs";
import type { FetchLike, GateDeps, HttpResponse } from "../src/client.js";

const ROOT = new URL("../fixtures/gate.v1/", import.meta.url);

export function readContract(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, ROOT), "utf8"));
}

export function fixture(name: string): Record<string, unknown> {
  return readContract(`fixtures/${name}.v1.json`) as Record<string, unknown>;
}

export const ANSWER_FIXTURES = [
  "release-gate-answer-pass",
  "release-gate-answer-pass-baseline",
  "release-gate-answer-pass-break-glass",
  "release-gate-answer-fail",
  "release-gate-answer-expired",
  "release-gate-answer-waiting",
] as const;

// Fake tokens of the real shape; never real values.
export const TOKEN = `zgt_${"A".repeat(43)}`;
export const BREAK_GLASS = `zbg_${"B".repeat(43)}`;

export const FIXTURE_ENV = {
  ZOF_GATE_TOKEN: TOKEN,
  ZOF_API_URL: "https://cp.example.com",
} as const;

// Matches release-gate-request.v1.json's repo, commit and environment.
export const FIXTURE_ARGS = [
  "--environment",
  "prod-eu",
  "--repo",
  "example-org/shop",
  "--commit",
  "a".repeat(40),
  "--run-id",
  "1234567890",
] as const;

export type Scripted =
  | { status: number; body: unknown; headers?: Record<string, string> }
  | { status: number; raw: string; headers?: Record<string, string> }
  | { throws: true }
  | { redirectTo: string };

export interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  redirect: string | undefined;
  at: number;
}

/** A fake network and clock: responses are served in order; the last one repeats. */
export function fakeDeps(script: Scripted[], start = Date.parse("2026-11-13T10:00:00Z")) {
  let now = start;
  const sent: Sent[] = [];
  const sleeps: number[] = [];
  const fetch: FetchLike = async (url, init) => {
    sent.push({
      url,
      method: init.method,
      headers: init.headers,
      body: init.body,
      redirect: init.redirect,
      at: now,
    });
    const step = script[Math.min(sent.length - 1, script.length - 1)];
    if (step !== undefined && "redirectTo" in step) {
      // Models undici: "error" rejects; "follow" (the default) re-sends custom headers to the target.
      if (init.redirect === "error") throw new TypeError("fetch failed: unexpected redirect");
      if (init.redirect !== "manual") {
        sent.push({ ...sent[sent.length - 1], url: step.redirectTo } as Sent);
        throw new Error("followed");
      }
      return {
        status: 302,
        headers: { get: (name) => (name.toLowerCase() === "location" ? step.redirectTo : null) },
        text: async () => "",
      };
    }
    if (step === undefined || "throws" in step)
      throw new Error(`connect failed ${init.headers.Authorization}`);
    const text = "raw" in step ? step.raw : JSON.stringify(step.body);
    const headers = new Map(
      Object.entries(step.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    );
    const response: HttpResponse = {
      status: step.status,
      headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
      text: async () => text,
    };
    return response;
  };
  const deps: GateDeps = {
    fetch,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    random: () => 0,
  };
  return { deps, sent, sleeps, elapsed: () => now - start };
}

export function captureIo(files: Record<string, string> = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stderr.push(line),
      readFile: (path: string) => files[path],
    },
    stdout,
    stderr,
    all: () => [...stdout, ...stderr].join("\n"),
  };
}
