import { describe, expect, it } from "vitest";
import { parseAnswer } from "../src/answer.js";
import type { GateAnswer } from "../src/contract.js";
import { finalLines, MAX_REASONS, reasonLines, waitingLines } from "../src/render.js";
import { fixture, TOKEN } from "./helpers.js";

function answer(name: string, over: Record<string, unknown> = {}): GateAnswer {
  const parsed = parseAnswer({ ...fixture(name), ...over });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

const reason = (i: number) => ({
  code: `code_${i}`,
  message: `Reason ${i}.`,
  remedy: null,
  requirement_key: null,
});

describe("reasons", () => {
  it("lists each reason with its code under the headline, then the console link once", () => {
    const fail = answer("release-gate-answer-fail", {
      reasons: [reason(1), reason(2)],
      reasons_total: 2,
    });
    expect(finalLines(fail, false)).toEqual([
      "Blocked: The deploy decision blocks this commit. Fix the reasons listed. The deploy decision is DENY.",
      "  - Reason 1. (code_1)",
      "  - Reason 2. (code_2)",
      "See https://console.example.com/releases/pr/chg-1",
    ]);
  });

  it("an empty list renders the headline only", () => {
    const fail = answer("release-gate-answer-fail", { reasons: [], reasons_total: 0 });
    expect(reasonLines(fail)).toEqual([]);
    expect(finalLines(fail, false)).toEqual([
      "Blocked: The deploy decision blocks this commit. Fix the reasons listed. The deploy decision is DENY.",
      "See https://console.example.com/releases/pr/chg-1",
    ]);
  });

  it(`shows at most ${MAX_REASONS}, then counts the rest from reasons_total`, () => {
    const reasons = Array.from({ length: 12 }, (_, i) => reason(i + 1));
    const lines = reasonLines(answer("release-gate-answer-fail", { reasons, reasons_total: 15 }));
    expect(lines).toHaveLength(MAX_REASONS + 1);
    expect(lines[MAX_REASONS - 1]).toBe("  - Reason 10. (code_10)");
    expect(lines[MAX_REASONS]).toBe("  +5 more");
  });

  it("waiting updates list the reasons too", () => {
    const lines = waitingLines(answer("release-gate-answer-waiting"));
    expect(lines).toEqual([
      "Waiting for evidence · until 2026-11-13T10:30:00Z",
      "  - A required check hasn't run yet. (missing_blocking_evidence)",
    ]);
  });

  it("prints only the CP's message and code, never a token in another field", () => {
    const fail = answer("release-gate-answer-fail", {
      reasons: [{ code: "x", message: "Tests failed.", remedy: TOKEN, requirement_key: TOKEN }],
      reasons_total: 1,
    });
    expect(finalLines(fail, false).join("\n")).not.toContain(TOKEN);
  });
});
