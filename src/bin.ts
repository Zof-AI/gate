#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { main } from "./cli.js";
import { Exit } from "./exit.js";

try {
  process.exitCode = await main(
    process.argv.slice(2),
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
  // Never a stack trace (it could carry request details); an internal failure is never a pass.
  process.stderr.write("zof-gate: internal error; Zof unavailable.\n");
  process.exitCode = Exit.Unavailable;
}
