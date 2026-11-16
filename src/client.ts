import { mismatch, parseAnswer, parseError } from "./answer.js";
import {
  BREAK_GLASS_REASON_MAX,
  type GateAnswer,
  type GateRequest,
  LONG_POLL_MAX_SECONDS,
} from "./contract.js";
import { dispositionFor, Exit, type ExitCode } from "./exit.js";
import { requestBody } from "./request.js";

export interface HttpResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    redirect: "error";
  },
) => Promise<HttpResponse>;

/** Everything with a side effect is injected, so tests run with no network and no real time. */
export interface GateDeps {
  fetch: FetchLike;
  now(): number;
  sleep(ms: number): Promise<void>;
  random(): number;
  /** A per-request abort signal; undefined in tests. */
  timeoutSignal?: ((ms: number) => AbortSignal) | undefined;
}

export interface GateCall {
  apiUrl: string;
  token: string;
  breakGlassToken: string | null;
  request: GateRequest;
  idempotencyKey: string;
  userAgent: string;
  maxWaitMs: number;
  noWait: boolean;
}

export interface GateOutcome {
  exit: ExitCode;
  /** The last valid answer, if any arrived. */
  answer: GateAnswer | null;
  /** Why it ended, in plain words, for the log. */
  message: string;
}

export interface Progress {
  answer(answer: GateAnswer): void;
}

const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 30_000;
const DEFAULT_POLL_MS = 2_000;
// A server asking for no delay still gets a floor, so a misbehaving answer can't make us spin.
const MIN_POLL_MS = 1_000;
const JITTER = 0.2;
const REQUEST_TIMEOUT_MS = 30_000;
// After the server's own deadline it records a final timeout on the next read; this bounds a stall.
const SERVER_DEADLINE_GRACE_MS = 60_000;

type Reply =
  | { kind: "answer"; answer: GateAnswer; retryAfterMs: number | null }
  | { kind: "end"; outcome: GateOutcome };

/** Retry-After as seconds or an HTTP date; null when absent or unreadable. */
export function retryAfterMs(header: string | null, nowMs: number): number | null {
  if (header === null) return null;
  const text = header.trim();
  if (/^[0-9]{1,6}$/.test(text)) return Number(text) * 1_000;
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : Math.max(0, at - nowMs);
}

function unavailable(message: string, answer: GateAnswer | null = null): GateOutcome {
  return { exit: Exit.Unavailable, answer, message: `Zof unavailable: ${message}` };
}

/** Pure: the exit for a valid, matching answer. Nothing but a final pass exits 0. */
export function exitForAnswer(answer: GateAnswer): ExitCode {
  if (answer.state === "final" && answer.result === "pass" && answer.basis !== null) {
    return Exit.Pass;
  }
  return Exit.Blocked;
}

export class GateClient {
  private readonly deadline: number;
  private gateId: string | null = null;

  constructor(
    private readonly call: GateCall,
    private readonly deps: GateDeps,
    private readonly progress: Progress = { answer: () => {} },
  ) {
    this.deadline = deps.now() + call.maxWaitMs;
  }

  async run(): Promise<GateOutcome> {
    const { request } = this.call;
    if (
      request.break_glass_reason !== null &&
      (this.call.breakGlassToken === null ||
        request.break_glass_reason.length > BREAK_GLASS_REASON_MAX)
    ) {
      return {
        exit: Exit.Token,
        answer: null,
        message: "Break-glass needs its token and a reason.",
      };
    }

    let reply = await this.send("POST", "/v1/gate/checks", requestBody(request));
    for (;;) {
      if (reply.kind === "end") return reply.outcome;
      const { answer } = reply;
      this.progress.answer(answer);
      if (answer.state === "final") {
        const exit = exitForAnswer(answer);
        return { exit, answer, message: exit === Exit.Pass ? "pass" : "blocked" };
      }
      if (this.call.noWait) {
        return { exit: Exit.Blocked, answer, message: "Still waiting, and --no-wait was given." };
      }
      const now = this.deps.now();
      const serverDeadline = Date.parse(answer.wait_until) + SERVER_DEADLINE_GRACE_MS;
      const stopAt = Math.min(this.deadline, serverDeadline);
      if (now >= stopAt) {
        return { exit: Exit.Blocked, answer, message: "Timed out waiting for Zof's decision." };
      }
      const pollMs =
        answer.poll_after_seconds === null ? DEFAULT_POLL_MS : answer.poll_after_seconds * 1_000;
      const base = Math.max(MIN_POLL_MS, pollMs, reply.retryAfterMs ?? 0);
      await this.deps.sleep(Math.min(base * (1 + this.deps.random() * JITTER), stopAt - now));
      const left = Math.floor((stopAt - this.deps.now()) / 1_000);
      const wait = Math.max(0, Math.min(LONG_POLL_MAX_SECONDS, left));
      reply = await this.send(
        "GET",
        `/v1/gate/checks/${this.gateId}?wait=${wait}`,
        undefined,
        wait,
      );
    }
  }

  private headers(method: string): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.call.token}`,
      Accept: "application/json",
      "User-Agent": this.call.userAgent,
    };
    if (method === "POST") {
      h["Content-Type"] = "application/json";
      h["Idempotency-Key"] = this.call.idempotencyKey;
      if (this.call.request.break_glass_reason !== null && this.call.breakGlassToken !== null) {
        h["X-Zof-Break-Glass"] = this.call.breakGlassToken;
      }
    }
    return h;
  }

  /** One logical request: retried on outages within the deadline, then exit 3. */
  private async send(
    method: "POST" | "GET",
    path: string,
    body: string | undefined,
    longPollSeconds = 0,
  ): Promise<Reply> {
    let lastProblem = "no answer";
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const result = await this.once(method, path, body, longPollSeconds);
      if (result.kind !== "retry") return result;
      lastProblem = result.problem;
      const backoff = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
      const waitMs = Math.max(
        result.retryAfterMs ?? 0,
        backoff * (1 + this.deps.random() * JITTER),
      );
      if (attempt === MAX_ATTEMPTS - 1 || this.deps.now() + waitMs > this.deadline) break;
      await this.deps.sleep(waitMs);
    }
    return { kind: "end", outcome: unavailable(lastProblem) };
  }

  private async once(
    method: "POST" | "GET",
    path: string,
    body: string | undefined,
    longPollSeconds: number,
  ): Promise<Reply | { kind: "retry"; problem: string; retryAfterMs: number | null }> {
    let response: HttpResponse;
    let text: string;
    try {
      const signal = this.deps.timeoutSignal?.(REQUEST_TIMEOUT_MS + longPollSeconds * 1_000);
      response = await this.deps.fetch(`${this.call.apiUrl}${path}`, {
        method,
        headers: this.headers(method),
        // A followed redirect would re-send X-Zof-Break-Glass to another host; a 3xx is exit 3.
        redirect: "error",
        ...(body === undefined ? {} : { body }),
        ...(signal === undefined ? {} : { signal }),
      });
      text = await response.text();
    } catch {
      // The error text can echo request details, so it is never shown.
      return { kind: "retry", problem: "the request did not complete", retryAfterMs: null };
    }

    const retryAfter = retryAfterMs(response.headers.get("Retry-After"), this.deps.now());
    let json: unknown;
    let parsed = true;
    try {
      json = JSON.parse(text);
    } catch {
      parsed = false;
    }

    const { status } = response;
    if (status === 200 || status === 201 || status === 202) {
      if (!parsed) return this.end(unavailable(`the answer was not JSON (HTTP ${status})`));
      const result = parseAnswer(json);
      if (!result.ok) return this.end(unavailable(`the answer was not valid: ${result.error}`));
      // 201 is a new final answer and 202 a waiting one (§3.3); a status that disagrees is not trusted.
      const expected = status === 201 ? "final" : status === 202 ? "waiting" : result.value.state;
      if (result.value.state !== expected) {
        return this.end(unavailable(`HTTP ${status} disagrees with the answer's state`));
      }
      const wrong = mismatch(result.value, this.call.request, this.gateId);
      if (wrong !== null) return this.end(unavailable(`the answer's ${wrong} does not match`));
      this.gateId = result.value.gate_id;
      return { kind: "answer", answer: result.value, retryAfterMs: retryAfter };
    }

    const error = parsed ? parseError(json) : null;
    const disposition = dispositionFor(status, error?.code ?? null);
    if (disposition.kind === "retry") {
      const why = error === null ? `HTTP ${status}` : `${error.code} (HTTP ${status})`;
      return { kind: "retry", problem: why, retryAfterMs: retryAfter };
    }
    if (error === null) return this.end(unavailable(`unexpected HTTP ${status}`));
    return this.end({
      exit: disposition.exit,
      answer: null,
      message: `${error.code}: ${error.detail}`,
    });
  }

  private end(outcome: GateOutcome): Reply {
    return { kind: "end", outcome };
  }
}
