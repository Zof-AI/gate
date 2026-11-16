// Entry point for the GitHub Action; bundled into dist/index.mjs by `npm run bundle`.
import { appendFileSync, readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { runAction } from "./action.js";
import { Exit } from "./exit.js";

try {
  process.exitCode = await runAction(
    process.env,
    {
      stdout: (line) => process.stdout.write(`${line}\n`),
      stderr: (line) => process.stderr.write(`${line}\n`),
      readFile(path) {
        try {
          return readFileSync(path, "utf8");
        } catch {
          return undefined;
        }
      },
      appendFile: (path, text) => appendFileSync(path, text, "utf8"),
    },
    {
      fetch: (url, init) => fetch(url, init),
      now: () => Date.now(),
      sleep: (ms) => delay(ms),
      random: () => Math.random(),
      timeoutSignal: (ms) => AbortSignal.timeout(ms),
    },
  );
} catch {
  // Never a stack trace; an internal failure is never a pass.
  process.stderr.write("zof-gate: internal error; Zof unavailable.\n");
  process.exitCode = Exit.Unavailable;
}
