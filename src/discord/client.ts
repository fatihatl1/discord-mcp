/**
 * Discord REST client: auth, retries, rate limiting.
 *
 * Rate limit strategy:
 * - Requests are keyed by route (method + path with only the major ids kept:
 *   guild, channel, webhook). Discord's real bucket hash is learned from the
 *   X-RateLimit-Bucket response header and routes are re-keyed onto it.
 * - Requests sharing a bucket are serialised through a promise chain, and a
 *   bucket with 0 remaining requests sleeps until X-RateLimit-Reset-After.
 * - A 429 with scope "global" pauses every request, not just its bucket.
 * - All non-GET requests additionally serialise through a single global write
 *   chain with a configurable inter-write delay, because role/channel creation
 *   is rate limited far more aggressively than reads.
 * - 5xx and network errors retry with jittered exponential backoff, max 5
 *   attempts. 4xx other than 429 never retries.
 */

import { log } from "../logging.js";

export interface DiscordClientOptions {
  token: string;
  /** e.g. "v10" */
  apiVersion?: string;
  /** When true, any non-GET request throws DryRunWriteError before any network I/O. */
  dryRun?: boolean;
  /** Delay between consecutive write requests, ms. Default 250. */
  writeDelayMs?: number;
  /** Injection points for tests. Defaults: globalThis.fetch / setTimeout / Date.now. */
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Max attempts for 5xx/network failures (total tries). Default 5. */
  maxAttempts?: number;
  /** Max retries after 429 responses before giving up. Default 10. */
  max429Retries?: number;
}

export interface RequestOptions {
  body?: unknown;
  /** Sent as X-Audit-Log-Reason so the action is traceable in the guild audit log. */
  reason?: string;
  query?: Record<string, string>;
}

/** Thrown when DRY_RUN is active and a write was attempted. */
export class DryRunWriteError extends Error {
  constructor(method: string, path: string) {
    super(`DRY_RUN is active: refused to send ${method} ${path} to Discord`);
    this.name = "DryRunWriteError";
  }
}

export class DiscordAPIError extends Error {
  readonly status: number;
  readonly code: number | undefined;
  readonly discordMessage: string;
  /** Flattened field errors from Discord's nested `errors` object. */
  readonly details: readonly string[];
  readonly hint: string | undefined;
  readonly method: string;
  readonly path: string;

  constructor(args: {
    status: number;
    code: number | undefined;
    discordMessage: string;
    details: readonly string[];
    hint: string | undefined;
    method: string;
    path: string;
  }) {
    const parts = [
      `Discord API error ${args.status}` +
        (args.code !== undefined ? ` (code ${args.code})` : "") +
        `: ${args.discordMessage}`,
    ];
    if (args.details.length > 0) parts.push(args.details.join("; "));
    if (args.hint) parts.push(args.hint);
    super(parts.join(" -- "));
    this.name = "DiscordAPIError";
    this.status = args.status;
    this.code = args.code;
    this.discordMessage = args.discordMessage;
    this.details = args.details;
    this.hint = args.hint;
    this.method = args.method;
    this.path = args.path;
  }
}

/**
 * Reduce a path to its rate-limit route key. Major ids (guild, channel,
 * webhook) are kept; every other snowflake collapses to :id.
 */
export function majorRoute(path: string): string {
  const parts = path.split("/");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part !== undefined && /^\d{15,}$/.test(part)) {
      const prev = parts[i - 1];
      if (prev !== "guilds" && prev !== "channels" && prev !== "webhooks") {
        parts[i] = ":id";
      }
    }
  }
  return parts.join("/");
}

/** Map the common Discord error codes / statuses to actionable hints. */
export function hintForError(
  status: number,
  code: number | undefined,
): string | undefined {
  switch (code) {
    case 50001:
      return (
        "Missing Access: the bot cannot see this guild or channel. Check that " +
        "the bot is a member of the guild and that no channel overwrite denies " +
        "it VIEW_CHANNEL."
      );
    case 50013:
      return (
        "Missing Permissions: the bot lacks a permission this operation needs " +
        "(typically MANAGE_ROLES or MANAGE_CHANNELS), or the target role sits " +
        "at or above the bot's highest role. Discord only lets a bot manage " +
        "roles strictly below its own top role -- drag the bot's role higher " +
        "in Server Settings -> Roles."
      );
    case 30013:
      return (
        "Guild limit reached: bots can only create guilds while they are in " +
        "fewer than 10 guilds. Instead of create_guild, create the server " +
        "manually (or use an existing one), invite the bot with the OAuth2 " +
        "URL from the README, then run apply_blueprint against that guild."
      );
    case 30005:
      return "Role limit reached: a guild can have at most 250 roles.";
    case 30011:
      return "Channel limit reached: a guild can have at most 500 channels.";
    case 50035:
      return (
        "Invalid Form Body: one or more fields were rejected. The field paths " +
        "above point at the offending values."
      );
    default:
      break;
  }
  if (code !== undefined && code >= 30000 && code < 31000) {
    return "A Discord resource limit was reached (30xxx error code family).";
  }
  switch (status) {
    case 401:
      return (
        "Unauthorized: DISCORD_BOT_TOKEN is missing, malformed, or revoked. " +
        "Copy a fresh token from the Discord developer portal (Bot tab)."
      );
    case 403:
      return (
        "Forbidden: the bot is not allowed to do this. Most commonly the " +
        "bot's highest role is not above the role it is trying to manage, or " +
        "it was invited without the Manage Roles / Manage Channels permissions."
      );
    default:
      return undefined;
  }
}

/**
 * Discord nests field errors like
 * { channels: { "0": { name: { _errors: [{ code, message }] } } } }.
 * Flatten to "channels.0.name: message (code)".
 */
export function flattenDiscordErrors(errors: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown, path: string[]): void => {
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const errList = record["_errors"];
    if (Array.isArray(errList)) {
      for (const e of errList) {
        const entry = e as { code?: string; message?: string };
        const msg = entry.message ?? "invalid";
        const code = entry.code ? ` (${entry.code})` : "";
        out.push(`${path.join(".") || "(body)"}: ${msg}${code}`);
      }
      return;
    }
    for (const [key, value] of Object.entries(record)) {
      walk(value, [...path, key]);
    }
  };
  walk(errors, []);
  return out;
}

interface BucketState {
  remaining: number;
  resetAt: number;
}

interface DiscordErrorBody {
  code?: number;
  message?: string;
  errors?: unknown;
  retry_after?: number;
  global?: boolean;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class DiscordClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly dryRun: boolean;
  private readonly writeDelayMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly maxAttempts: number;
  private readonly max429Retries: number;

  /** Serialisation chains, keyed by bucket (or route until the bucket is learned). */
  private readonly queues = new Map<string, Promise<unknown>>();
  /** Learned mapping from route key to Discord bucket hash. */
  private readonly routeToBucket = new Map<string, string>();
  /** Remaining/reset state per bucket key. */
  private readonly buckets = new Map<string, BucketState>();
  /** When in the future, ALL requests wait (global rate limit). */
  private globalBlockedUntil = 0;
  /** All writes serialise through this chain, with writeDelayMs between them. */
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(opts: DiscordClientOptions) {
    this.token = opts.token;
    const version = opts.apiVersion ?? "v10";
    this.baseUrl = `https://discord.com/api/${version}`;
    this.dryRun = opts.dryRun ?? false;
    this.writeDelayMs = opts.writeDelayMs ?? 250;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.sleep = opts.sleep ?? defaultSleep;
    this.now = opts.now ?? Date.now;
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.max429Retries = opts.max429Retries ?? 10;
  }

  get isDryRun(): boolean {
    return this.dryRun;
  }

  async request<T>(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    path: string,
    opts: RequestOptions = {},
  ): Promise<T> {
    const isWrite = method !== "GET";
    if (isWrite && this.dryRun) {
      throw new DryRunWriteError(method, path);
    }

    const routeKey = `${method} ${majorRoute(path)}`;
    const run = (): Promise<T> =>
      this.executeWithRetries<T>(method, path, routeKey, opts);

    if (isWrite) {
      // Serialise ALL writes globally; keep an inter-write delay between them.
      const prev = this.writeChain;
      const result = prev.then(run, run);
      this.writeChain = result.then(
        () => (this.writeDelayMs > 0 ? this.sleep(this.writeDelayMs) : undefined),
        () => (this.writeDelayMs > 0 ? this.sleep(this.writeDelayMs) : undefined),
      );
      return result;
    }

    // Reads serialise per bucket only.
    const bucketKey = this.routeToBucket.get(routeKey) ?? `route:${routeKey}`;
    const prev = this.queues.get(bucketKey) ?? Promise.resolve();
    const result = prev.then(run, run);
    this.queues.set(
      bucketKey,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  }

  private bucketKeyFor(routeKey: string): string {
    return this.routeToBucket.get(routeKey) ?? `route:${routeKey}`;
  }

  private async waitForGlobal(): Promise<void> {
    const wait = this.globalBlockedUntil - this.now();
    if (wait > 0) {
      log.debug("waiting for global rate limit", { wait_ms: wait });
      await this.sleep(wait);
    }
  }

  private async waitForBucket(routeKey: string): Promise<void> {
    const state = this.buckets.get(this.bucketKeyFor(routeKey));
    if (!state) return;
    const wait = state.resetAt - this.now();
    if (state.remaining <= 0 && wait > 0) {
      log.debug("waiting for bucket rate limit", { route: routeKey, wait_ms: wait });
      await this.sleep(wait);
    }
  }

  private updateBucketFromHeaders(routeKey: string, headers: Headers): void {
    const bucket = headers.get("x-ratelimit-bucket");
    if (bucket) {
      this.routeToBucket.set(routeKey, `bucket:${bucket}`);
    }
    const remaining = headers.get("x-ratelimit-remaining");
    const resetAfter = headers.get("x-ratelimit-reset-after");
    if (remaining !== null && resetAfter !== null) {
      const remainingNum = Number(remaining);
      const resetAfterNum = Number(resetAfter);
      if (Number.isFinite(remainingNum) && Number.isFinite(resetAfterNum)) {
        this.buckets.set(this.bucketKeyFor(routeKey), {
          remaining: remainingNum,
          resetAt: this.now() + resetAfterNum * 1000,
        });
      }
    }
  }

  private async executeWithRetries<T>(
    method: string,
    path: string,
    routeKey: string,
    opts: RequestOptions,
  ): Promise<T> {
    let attempts = 0;
    let retries429 = 0;

    for (;;) {
      await this.waitForGlobal();
      await this.waitForBucket(routeKey);

      let res: Response;
      try {
        res = await this.doFetch(method, path, opts);
      } catch (err) {
        // Network-level failure: retry like a 5xx.
        attempts++;
        log.warn("discord request network error", {
          method,
          path,
          attempt: attempts,
          error: err instanceof Error ? err.message : String(err),
        });
        if (attempts >= this.maxAttempts) {
          throw new DiscordAPIError({
            status: 0,
            code: undefined,
            discordMessage: `Network error after ${attempts} attempts: ${
              err instanceof Error ? err.message : String(err)
            }`,
            details: [],
            hint: "Check network connectivity to discord.com.",
            method,
            path,
          });
        }
        await this.backoff(attempts);
        continue;
      }

      this.updateBucketFromHeaders(routeKey, res.headers);

      if (res.status === 429) {
        const body = (await safeJson(res)) as DiscordErrorBody | undefined;
        const scope = res.headers.get("x-ratelimit-scope");
        const isGlobal = scope === "global" || body?.global === true;
        let retryAfter = body?.retry_after;
        if (typeof retryAfter !== "number" || !Number.isFinite(retryAfter)) {
          const header = res.headers.get("retry-after");
          retryAfter = header !== null ? Number(header) : 1;
        }
        if (!Number.isFinite(retryAfter) || retryAfter < 0) retryAfter = 1;
        const waitMs = Math.ceil(retryAfter * 1000);

        log.warn("discord rate limited (429)", {
          method,
          path,
          scope: isGlobal ? "global" : (scope ?? "bucket"),
          retry_after_s: retryAfter,
        });

        retries429++;
        if (retries429 > this.max429Retries) {
          throw new DiscordAPIError({
            status: 429,
            code: body?.code,
            discordMessage: `Rate limited ${retries429} times in a row; giving up`,
            details: [],
            hint: "Discord is throttling this bot heavily. Wait a while and retry, or raise WRITE_DELAY_MS.",
            method,
            path,
          });
        }

        if (isGlobal) {
          // Pause EVERY request until the window passes; waitForGlobal at the
          // top of the loop performs this request's own sleep.
          this.globalBlockedUntil = Math.max(
            this.globalBlockedUntil,
            this.now() + waitMs,
          );
        } else {
          await this.sleep(waitMs);
        }
        continue;
      }

      if (res.status >= 500) {
        attempts++;
        log.warn("discord server error", {
          method,
          path,
          status: res.status,
          attempt: attempts,
        });
        if (attempts >= this.maxAttempts) {
          throw await this.toError(res, method, path);
        }
        await this.backoff(attempts);
        continue;
      }

      if (!res.ok) {
        // 4xx other than 429: never retried.
        throw await this.toError(res, method, path);
      }

      log.debug("discord request ok", { method, path, status: res.status });
      if (res.status === 204) {
        return undefined as T;
      }
      return (await res.json()) as T;
    }
  }

  private async backoff(attempt: number): Promise<void> {
    const base = Math.min(1000 * 2 ** (attempt - 1), 15000);
    const jitter = Math.random() * base * 0.25;
    await this.sleep(base + jitter);
  }

  private async doFetch(
    method: string,
    path: string,
    opts: RequestOptions,
  ): Promise<Response> {
    let url = `${this.baseUrl}${path}`;
    if (opts.query) {
      const qs = new URLSearchParams(opts.query).toString();
      if (qs) url += `?${qs}`;
    }
    const headers: Record<string, string> = {
      Authorization: `Bot ${this.token}`,
      "User-Agent":
        "DiscordBot (https://github.com/tyfur/discord-provisioner-mcp, 0.2.0)",
    };
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (opts.reason) {
      // Discord URL-decodes this header server-side; 512 char limit applies
      // to the decoded value.
      headers["X-Audit-Log-Reason"] = encodeURIComponent(
        opts.reason.slice(0, 512),
      );
    }
    return this.fetchFn(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  }

  private async toError(
    res: Response,
    method: string,
    path: string,
  ): Promise<DiscordAPIError> {
    const body = (await safeJson(res)) as DiscordErrorBody | undefined;
    const code = body?.code;
    const message = body?.message ?? res.statusText ?? "Unknown error";
    const details = body?.errors ? flattenDiscordErrors(body.errors) : [];
    const err = new DiscordAPIError({
      status: res.status,
      code,
      discordMessage: message,
      details,
      hint: hintForError(res.status, code),
      method,
      path,
    });
    log.warn("discord request failed", {
      method,
      path,
      status: res.status,
      code,
      message,
    });
    return err;
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}
