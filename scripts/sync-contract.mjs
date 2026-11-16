#!/usr/bin/env node
// Copies the gate.v1 contract and CP-1 fixtures from a control_plane checkout, byte for byte,
// and records where they came from. Usage: node scripts/sync-contract.mjs <control_plane> [ref]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [cpDir, ref = "origin/stg"] = process.argv.slice(2);
if (!cpDir) {
  console.error("Usage: node scripts/sync-contract.mjs <control_plane checkout> [ref]");
  process.exit(2);
}
const git = (...args) => execFileSync("git", ["-C", cpDir, ...args], { encoding: "utf8" });
const out = join(import.meta.dirname, "..", "fixtures", "gate.v1");

const sources = {
  "openapi.gate.v1.json": "docs/openapi/gate.v1.json",
  "schemas/release_gate.v1.json": "docs/schemas/release_gate.v1.json",
  "schemas/release_gate_request.v1.json": "docs/schemas/release_gate_request.v1.json",
};
for (const path of git("ls-tree", "--name-only", ref, "fixtures/control/").split("\n")) {
  const name = path.split("/").pop();
  if (name?.startsWith("release-gate-")) sources[`fixtures/${name}`] = path;
}

const files = {};
for (const [local, remote] of Object.entries(sources).sort()) {
  const text = git("show", `${ref}:${remote}`);
  mkdirSync(dirname(join(out, local)), { recursive: true });
  writeFileSync(join(out, local), text);
  files[local] = { source: remote, sha256: createHash("sha256").update(text).digest("hex") };
}
const openapi = JSON.parse(git("show", `${ref}:docs/openapi/gate.v1.json`));
const manifest = {
  contract: "gate.v1",
  schema_version: 1,
  openapi_version: openapi.info.version,
  source_repo: "Zof-AI/control_plane",
  source_ref: ref,
  source_commit: git("rev-parse", ref).trim(),
  files,
};
writeFileSync(join(out, "SOURCE.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Synced ${Object.keys(files).length} files from ${manifest.source_commit}.`);
