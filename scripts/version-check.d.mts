export function highestRelease(versions: readonly string[]): string | null;
export function checkVersion(
  requested: string,
  published: readonly string[] | null,
): { ok: boolean; message: string };
export function parseNpmView(stdout: string, exitedOk: boolean): string[] | null;
