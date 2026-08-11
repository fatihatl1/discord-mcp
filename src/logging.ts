/**
 * Structured logging to stderr.
 *
 * In stdio mode, stdout carries the MCP protocol. Nothing in this project may
 * ever write to stdout except the transport itself, so every log line goes to
 * process.stderr as a single JSON object per line.
 *
 * Secrets (bot token, HTTP auth token) are registered at startup and scrubbed
 * from every emitted line as a last line of defense.
 */

const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 99,
} as const;

export type LogLevel = keyof typeof LEVELS;

let currentLevel: number = LEVELS.info;
let secrets: string[] = [];

export function configureLogging(opts: {
  level?: string | undefined;
  redact?: ReadonlyArray<string | undefined>;
}): void {
  if (opts.level) {
    const key = opts.level.toLowerCase();
    if (key in LEVELS) {
      currentLevel = LEVELS[key as LogLevel];
    }
  }
  if (opts.redact) {
    secrets = opts.redact.filter(
      (s): s is string => typeof s === "string" && s.length > 0,
    );
  }
}

/** Replace every registered secret with [REDACTED]. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const secret of secrets) {
    out = out.split(secret).join("[REDACTED]");
  }
  return out;
}

function jsonSafe(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  return value;
}

function emit(
  level: Exclude<LogLevel, "silent">,
  msg: string,
  fields?: Record<string, unknown>,
): void {
  if (LEVELS[level] < currentLevel) return;
  let line: string;
  try {
    line = JSON.stringify(
      { ts: new Date().toISOString(), level, msg, ...fields },
      jsonSafe,
    );
  } catch {
    line = JSON.stringify({ ts: new Date().toISOString(), level, msg });
  }
  process.stderr.write(redactSecrets(line) + "\n");
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>): void =>
    emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>): void =>
    emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>): void =>
    emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>): void =>
    emit("error", msg, fields),
};
