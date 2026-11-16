import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { Exit } from "../src/exit.js";
import {
  captureIo,
  FIXTURE_ARGS,
  FIXTURE_ENV,
  fakeDeps,
  fixture,
  type Scripted,
} from "./helpers.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Independent oracle: what a response must be for exit 0 to be allowed (S2). */
function isStoredPass(step: Scripted): boolean {
  if ("throws" in step || "raw" in step || "redirectTo" in step) return false;
  if (![200, 201].includes(step.status)) return false;
  const a = step.body as Record<string, unknown> | null;
  if (typeof a !== "object" || a === null) return false;
  if (a.state !== "final" || a.result !== "pass" || a.failure !== null) return false;
  if (a.repo !== "example-org/shop" || a.commit_sha !== "a".repeat(40)) return false;
  if (a.environment !== "prod-eu") return false;
  if (a.basis === "baseline") return true;
  return (
    a.basis === "decision" &&
    a.verdict === "allow" &&
    UUID.test(String(a.authorization_id)) &&
    UUID.test(String(a.decision_id))
  );
}

const PASS = fixture("release-gate-answer-pass");
const KEYS = Object.keys(PASS);
const anyJson = fc.oneof(
  fc.constantFrom(
    "pass",
    "fail",
    "waiting",
    "final",
    "allow",
    "deny",
    "decision",
    "baseline",
    "break_glass",
  ),
  fc.jsonValue(),
);

/** A real answer with up to three fields replaced or removed. */
const mutatedAnswer = fc
  .array(fc.tuple(fc.constantFrom(...KEYS), fc.option(anyJson, { nil: undefined })), {
    minLength: 1,
    maxLength: 3,
  })
  .chain((edits) =>
    fc
      .constantFrom(
        ...[
          PASS,
          fixture("release-gate-answer-pass-baseline"),
          fixture("release-gate-answer-fail"),
          fixture("release-gate-answer-expired"),
        ],
      )
      .map((base) => {
        const out: Record<string, unknown> = { ...base };
        for (const [k, v] of edits) {
          if (v === undefined) delete out[k];
          else out[k] = v;
        }
        return out;
      }),
  );

const step: fc.Arbitrary<Scripted> = fc.oneof(
  fc.record({ throws: fc.constant(true as const) }),
  fc.record({ status: fc.integer({ min: 100, max: 599 }), raw: fc.string() }),
  fc.record({ status: fc.integer({ min: 100, max: 599 }), body: fc.jsonValue() }),
  fc.record({ status: fc.constantFrom(200, 201, 202), body: mutatedAnswer }),
  fc.record({
    status: fc.integer({ min: 400, max: 599 }),
    body: fc.record({ code: fc.string(), detail: fc.string() }),
  }),
);

describe("exit-code property (S2)", () => {
  it("nothing but a stored pass for this request exits 0", async () => {
    await fc.assert(
      fc.asyncProperty(step, async (s) => {
        const net = fakeDeps([s]);
        const exit = await main(
          [...FIXTURE_ARGS, "--no-wait"],
          FIXTURE_ENV,
          captureIo().io,
          net.deps,
        );
        if (exit === Exit.Pass) expect(isStoredPass(s)).toBe(true);
        expect([0, 1, 2, 3, 4]).toContain(exit);
      }),
      { numRuns: 1_500 },
    );
  });

  it("every outage is exactly 3", async () => {
    const outage: fc.Arbitrary<Scripted> = fc.oneof(
      fc.record({ throws: fc.constant(true as const) }),
      fc.record({ status: fc.integer({ min: 500, max: 599 }), raw: fc.string() }),
      fc.record({ status: fc.integer({ min: 500, max: 599 }), body: fc.jsonValue() }),
      fc.record({ status: fc.constant(429), body: fc.jsonValue() }),
      fc.record({
        status: fc.constantFrom(200, 201, 202),
        raw: fc.string().filter((t) => {
          try {
            JSON.parse(t);
            return false;
          } catch {
            return true;
          }
        }),
      }),
    );
    await fc.assert(
      fc.asyncProperty(outage, async (s) => {
        const net = fakeDeps([s]);
        const exit = await main(FIXTURE_ARGS, FIXTURE_ENV, captureIo().io, net.deps);
        expect(exit).toBe(Exit.Unavailable);
      }),
      { numRuns: 300 },
    );
  });

  it("a sequence of answers never passes unless the last one read is a stored pass", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(step, { minLength: 1, maxLength: 4 }), async (steps) => {
        const net = fakeDeps(steps);
        const exit = await main(FIXTURE_ARGS, FIXTURE_ENV, captureIo().io, net.deps);
        if (exit === Exit.Pass) {
          const last = steps[Math.min(net.sent.length, steps.length) - 1];
          expect(last !== undefined && isStoredPass(last)).toBe(true);
        }
      }),
      { numRuns: 500 },
    );
  });
});
