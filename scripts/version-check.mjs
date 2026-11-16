// Release guard: the requested version must be above every real x.y.z release on npm. Prereleases
// and placeholders (npm's staged `0.0.0-stage`) are not releases, so they never set the floor.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const STRICT = /^(\d+)\.(\d+)\.(\d+)$/;

const parse = (v) => {
  const m = STRICT.exec(v);
  return m ? m.slice(1).map(Number) : null;
};

const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** Returns the highest strict x.y.z in `versions`, or null when there is none. */
export function highestRelease(versions) {
  let best = null;
  for (const v of versions) {
    const parsed = parse(v);
    if (parsed && (best === null || compare(parsed, best.parsed) > 0)) best = { v, parsed };
  }
  return best ? best.v : null;
}

/**
 * Decides whether `requested` may be released given the published versions (null when the package
 * does not exist). Returns { ok, message }.
 */
export function checkVersion(requested, published) {
  const req = parse(requested);
  if (!req) return { ok: false, message: `Version must be x.y.z, got ${requested}` };
  const highest = highestRelease(published ?? []);
  if (highest === null)
    return { ok: true, message: `No x.y.z release on npm yet; ${requested} is new` };
  if (compare(req, parse(highest)) <= 0) {
    return {
      ok: false,
      message: `Version ${requested} is not above the highest npm release ${highest}`,
    };
  }
  return { ok: true, message: `Version ${requested} is above the highest npm release ${highest}` };
}

/**
 * Reads `npm view <pkg> versions --json` output. Returns the version list, null for E404, and
 * throws on anything else so an unreadable registry answer never passes the check.
 */
export function parseNpmView(stdout, exitedOk) {
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error("npm view returned output that is not JSON");
  }
  if (!exitedOk) {
    if (data?.error?.code === "E404") return null;
    throw new Error(`npm view failed: ${data?.error?.code ?? "unknown error"}`);
  }
  // npm prints a bare string when exactly one version exists.
  if (typeof data === "string") return [data];
  if (Array.isArray(data) && data.every((v) => typeof v === "string")) return data;
  throw new Error("npm view returned an unexpected versions shape");
}

function main() {
  const [pkg, requested] = process.argv.slice(2);
  if (!pkg || !requested) {
    console.error("usage: version-check.mjs <package> <version>");
    process.exit(2);
  }
  let stdout = "";
  let exitedOk = true;
  try {
    stdout = execFileSync("npm", ["view", pkg, "versions", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (err) {
    exitedOk = false;
    stdout = typeof err?.stdout === "string" ? err.stdout : "";
  }
  let result;
  try {
    result = checkVersion(requested, parseNpmView(stdout, exitedOk));
  } catch (err) {
    result = { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  if (!result.ok) {
    console.error(`::error::${result.message}`);
    process.exit(1);
  }
  console.log(result.message);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
