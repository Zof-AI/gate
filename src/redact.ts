// Zof credential prefixes (§8, §10): pipeline, break-glass, deploy and console tokens.
const ZOF_TOKEN = /(zgt|zbg|zdt|zct)_[A-Za-z0-9_-]+/g;
const BEARER = /(bearer)\s+[^\s"',;]+/gi;
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping terminal escapes is the point.
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-_]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are replaced on purpose.
const CONTROL = /[\x00-\x1f\x7f]/g;

const MIN_SECRET_LENGTH = 4;

/** Removes every Zof token, bearer value and known secret from a line before it is written. */
export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= MIN_SECRET_LENGTH) {
      out = out.split(secret).join("***");
    }
  }
  return out.replace(ZOF_TOKEN, "$1_***").replace(BEARER, "$1 ***");
}

/** Makes server or user text safe for one log line: no escapes, no CI workflow commands. */
export function sanitizeLine(text: string): string {
  const flat = text.replace(ANSI, "").replace(CONTROL, " ");
  return flat.startsWith("::") ? ` ${flat}` : flat;
}

export interface Logger {
  line(text: string): void;
}

export function createLogger(write: (line: string) => void, secrets: readonly string[]): Logger {
  return {
    line(text: string): void {
      for (const part of text.split("\n")) {
        write(redact(sanitizeLine(part), secrets));
      }
    },
  };
}
