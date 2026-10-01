#!/usr/bin/env -S npx tsx
/**
 * Phase 3H.4 -- CONTROLLED FIRST LIVE POST.
 *
 * DANGER, unlike every previous phase script: this one CAN and WILL send a
 * real Discord message per channel when a genuinely fresh, non-duplicate
 * Finnhub article exists. Only run this with explicit, current Owner
 * authorization (granted for this phase).
 *
 * Safety design:
 *  1. NEWS_DRY_RUN=false / DRY_RUN=false / NEWS_MAX_POSTS_PER_CHANNEL=1 are
 *     applied as PROCESS-LEVEL overrides only, inside this script's own
 *     process.env, AFTER loading .env -- the .env file on disk is never
 *     written to, so the normal production cap (3) and dry-run-by-default
 *     posture are restored automatically the instant this process exits
 *     (Part 5/15).
 *  2. Message SELECTION (which single fresh, non-duplicate article to post
 *     per channel when more than one qualifies -- Part 8: prefer
 *     High > Medium > Low, then newest) is computed in THIS SCRIPT ONLY,
 *     against the full age-filtered/deduped candidate set.
 *     src/news/flood_control.ts itself is NOT modified -- its existing
 *     chronological, anti-backlog cap behavior (and tests) keep protecting
 *     the normal cap=3 production path unchanged.
 *  3. The actual write still goes through the real, unmodified
 *     publishCategory() pipeline (fetch -> dedup -> flood control ->
 *     isProviderPublishable -> createMessage). This script never calls
 *     createMessage itself -- it only hands publishCategory a one-item
 *     provider wrapping the single article already selected in step 2, so
 *     publishCategory's own real duplicate/freshness re-check still runs
 *     immediately before the write, as an independent safety layer.
 *  4. Every published message is immediately read back by id and validated
 *     against the exact expected content; any mismatch stops all further
 *     publishing for remaining categories (Part 12) without auto-deleting
 *     anything.
 *  5. Never prints DISCORD_BOT_TOKEN or FINNHUB_API_KEY.
 *
 * Run with: npx tsx scripts/phase3h4_live_publish.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { NEWS_CHANNELS, NEWS_CATEGORIES, type NewsCategory } from "../src/config/bullhaus.js";
import { DiscordClient, DiscordAPIError } from "../src/discord/client.js";
import { DiscordEndpoints } from "../src/discord/endpoints.js";
import { MESSAGE_FLAGS, type APIMessage } from "../src/discord/types.js";
import { loadNewsConfig } from "../src/news/config.js";
import { dedupeItems, fetchRecentlyPublishedUrls, normalizeArticleUrl } from "../src/news/dedup.js";
import { applyFloodControl } from "../src/news/flood_control.js";
import { formatNewsMessage } from "../src/news/format.js";
import { FinnhubProvider } from "../src/news/providers/finnhub_provider.js";
import type { NewsProvider } from "../src/news/provider.js";
import { publishCategory } from "../src/news/publisher.js";
import type { NewsItem } from "../src/news/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = join(__dirname, "..", "reports", "phase3h4_data.json");

// --- Load .env (never overwrites already-set process env vars), same as --
// prior phase scripts -- this repo's tooling never uses a dotenv package. --
function loadDotEnv(path: string): void {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnv(join(__dirname, "..", ".env"));

// --- Part 5: process-level-only overrides for THIS controlled run. The
// .env file on disk is never touched, so these revert the moment this
// process exits. ------------------------------------------------------------
process.env["NEWS_DRY_RUN"] = "false";
process.env["DRY_RUN"] = "false"; // not read by the News Worker pipeline (only src/index.ts's MCP tools read it); set for documentation/consistency only.
process.env["NEWS_MAX_POSTS_PER_CHANNEL"] = "1";

// --- Instrumented fetch: counts real requests by host+method, records every
// non-GET Discord call with its path, never logs a URL's query string (which
// would leak the Finnhub token). ---------------------------------------------
interface HostCounts {
  GET: number;
  nonGetMethods: string[];
}
const requestCounts: Record<string, HostCounts> = {};
const discordWrites: Array<{ method: string; path: string }> = [];

function record(hostname: string, method: string, pathname: string): void {
  const entry = (requestCounts[hostname] ??= { GET: 0, nonGetMethods: [] });
  if (method === "GET") {
    entry.GET += 1;
  } else {
    entry.nonGetMethods.push(method);
    if (hostname === "discord.com") discordWrites.push({ method, path: pathname });
  }
}

const instrumentedFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? "GET").toUpperCase();
  let hostname = "unknown";
  let pathname = "unknown";
  try {
    const u = new URL(url);
    hostname = u.hostname;
    pathname = u.pathname;
  } catch {
    // ignore
  }
  record(hostname, method, pathname);
  return fetch(input, init);
};

/** Pure pass-through wrapper around DiscordEndpoints that records each APIMessage a live createMessage call returns. */
class RecordingApi {
  lastCreated: APIMessage | undefined;
  constructor(private readonly inner: DiscordEndpoints) {}
  getCurrentUser: DiscordEndpoints["getCurrentUser"] = () => this.inner.getCurrentUser();
  listMessages: DiscordEndpoints["listMessages"] = (channelId, query) =>
    this.inner.listMessages(channelId, query);
  async createMessage(
    channelId: string,
    payload: Parameters<DiscordEndpoints["createMessage"]>[1],
  ): Promise<APIMessage> {
    const message = await this.inner.createMessage(channelId, payload);
    this.lastCreated = message;
    return message;
  }
}

/** Hands publishCategory exactly the one article this script already selected (Part 8) -- never more. */
class FixedItemProvider implements NewsProvider {
  readonly id = "finnhub";
  constructor(
    private readonly category: NewsCategory,
    private readonly item: NewsItem,
  ) {}
  async fetchCategory(category: NewsCategory): Promise<NewsItem[]> {
    return category === this.category ? [this.item] : [];
  }
}

const IMPACT_PRIORITY: Record<NewsItem["estimatedImpact"], number> = { high: 0, medium: 1, low: 2 };

/** Part 8: among several fresh, non-duplicate candidates, prefer High > Medium > Low, then newest within a level. */
function selectBestCandidate(candidates: readonly NewsItem[]): NewsItem | undefined {
  if (candidates.length === 0) return undefined;
  const sorted = [...candidates].sort((a, b) => {
    const priorityDiff = IMPACT_PRIORITY[a.estimatedImpact] - IMPACT_PRIORITY[b.estimatedImpact];
    if (priorityDiff !== 0) return priorityDiff;
    return Date.parse(b.publishedAt) - Date.parse(a.publishedAt); // newest first
  });
  return sorted[0];
}

interface ChannelPinState {
  pinnedIds: string[];
  pinnedContentById: Record<string, string>;
}

async function readPinState(
  api: DiscordEndpoints,
  channelId: string,
  limit: number,
): Promise<ChannelPinState> {
  const messages = await api.listMessages(channelId, { limit });
  const pinned = messages.filter((m) => m.pinned);
  return {
    pinnedIds: pinned.map((m) => m.id),
    pinnedContentById: Object.fromEntries(pinned.map((m) => [m.id, m.content])),
  };
}

interface CategoryReport {
  category: NewsCategory;
  channelId: string;
  fetchedCount: number;
  duplicateCheckOk: boolean;
  duplicateCheckError?: string;
  staleCount: number;
  eligibleCandidateCount: number;
  selected?: {
    headline: string;
    estimatedImpact: string;
    source: string;
    publishedAt: string;
    url: string;
    formattedPreview: string;
  };
  published: boolean;
  skipReason?: string;
  messageId?: string;
  readBack?: {
    ok: boolean;
    problems: string[];
    channelId: string;
    authorId: string;
    contentMatches: boolean;
    suppressEmbeds: boolean;
    hasEmbeds: boolean;
    pinned: boolean;
    mentionEveryone: boolean;
    mentionRolesCount: number;
    mentionsCount: number;
  };
  duplicateRecheckOk?: boolean;
  pinnedIntegrityOk?: boolean;
}

interface Report {
  generatedAt: string;
  config: {
    providers: string[];
    dryRun: boolean;
    publishEnabled: boolean;
    finnhubLicenseApproved: boolean;
    maxAgeMinutes: number;
    maxPostsPerChannel: number;
    historyLookback: number;
  };
  preflight: { ok: boolean; error?: string };
  auth: { ok: boolean; botId?: string; botUsername?: string; error?: string };
  categories: CategoryReport[];
  malformedStop: boolean;
  malformedDetail?: { category: string; channelId: string; messageId: string; problems: string[] };
  requestCounts: Record<string, HostCounts>;
  discordWrites: Array<{ method: string; path: string }>;
  stoppedEarly: boolean;
  stopReason?: string;
}

function writeReport(data: Report): void {
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(data, null, 2), "utf8");
  console.log(`\nWrote ${OUT_FILE}`);
}

async function main(): Promise<void> {
  const config = loadNewsConfig();

  const report: Report = {
    generatedAt: new Date().toISOString(),
    config: {
      providers: config.providers,
      dryRun: config.dryRun,
      publishEnabled: config.publishEnabled,
      finnhubLicenseApproved: config.finnhubLicenseApproved,
      maxAgeMinutes: config.maxAgeMinutes,
      maxPostsPerChannel: config.maxPostsPerChannel,
      historyLookback: config.historyLookback,
    },
    preflight: { ok: false },
    auth: { ok: false },
    categories: [],
    malformedStop: false,
    requestCounts,
    discordWrites,
    stoppedEarly: false,
  };

  // --- Hard pre-flight assertions -- refuse to construct any client at all
  // unless every safety-relevant override took effect exactly as intended. --
  const problems: string[] = [];
  if (config.dryRun !== false) problems.push(`expected dryRun=false after override, got ${config.dryRun}`);
  if (config.publishEnabled !== true) problems.push("NEWS_PUBLISH_ENABLED must be true");
  if (config.finnhubLicenseApproved !== true) problems.push("NEWS_LICENSE_APPROVED must be true");
  if (config.providers.length !== 1 || config.providers[0] !== "finnhub") {
    problems.push(`providers must be exactly ["finnhub"], got ${JSON.stringify(config.providers)}`);
  }
  if (config.maxPostsPerChannel !== 1) {
    problems.push(`expected maxPostsPerChannel=1 override, got ${config.maxPostsPerChannel}`);
  }
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) problems.push("DISCORD_BOT_TOKEN is not set");
  if (!process.env["FINNHUB_API_KEY"]) problems.push("FINNHUB_API_KEY is not set");

  if (problems.length > 0) {
    report.preflight = { ok: false, error: problems.join("; ") };
    report.stoppedEarly = true;
    report.stopReason = "preflight_failed";
    writeReport(report);
    console.error("STOP (preflight failed): " + problems.join("; "));
    console.error("Not calling Discord or Finnhub.");
    process.exitCode = 1;
    return;
  }
  report.preflight = { ok: true };

  const client = new DiscordClient({
    token: token as string,
    apiVersion: process.env["DISCORD_API_VERSION"] ?? "v10",
    dryRun: config.dryRun, // false this run -- writes are possible
    fetchFn: instrumentedFetch,
  });
  const api = new DiscordEndpoints(client);

  // --- Part 6: Discord auth ---------------------------------------------
  let botId: string;
  try {
    const me = await api.getCurrentUser();
    botId = me.id;
    report.auth = { ok: true, botId: me.id, botUsername: me.username };
    console.log(`Discord auth OK: bot user id=${me.id} username=${me.username}`);
  } catch (err) {
    const status = err instanceof DiscordAPIError ? err.status : undefined;
    report.auth = { ok: false, error: err instanceof Error ? err.message : String(err) };
    report.stoppedEarly = true;
    report.stopReason = "discord_auth_failed";
    writeReport(report);
    console.error(`STOP: Discord authentication failed${status ? ` (HTTP ${status})` : ""}.`);
    process.exitCode = 1;
    return;
  }

  const finnhub = new FinnhubProvider({ fetchFn: instrumentedFetch });

  // --- Part 6: pre-publication channel read + pinned-intro snapshot -------
  const pinStateBefore = new Map<NewsCategory, ChannelPinState>();
  for (const category of NEWS_CATEGORIES) {
    const channelId = NEWS_CHANNELS[category];
    try {
      const state = await readPinState(api, channelId, config.historyLookback);
      pinStateBefore.set(category, state);
      console.log(`Channel #${channelId} (${category}): accessible, ${state.pinnedIds.length} pinned message(s)`);
    } catch (err) {
      report.stoppedEarly = true;
      report.stopReason = `channel_read_failed:${category}`;
      writeReport(report);
      console.error(`STOP: channel #${channelId} (${category}) read failed -- ${String(err)}`);
      console.error("Fail closed: not publishing anything this run.");
      process.exitCode = 1;
      return;
    }
  }

  let malformedStop = false;

  for (const category of NEWS_CATEGORIES) {
    if (malformedStop) break;

    const channelId = NEWS_CHANNELS[category];
    const catReport: CategoryReport = {
      category,
      channelId,
      fetchedCount: 0,
      duplicateCheckOk: false,
      staleCount: 0,
      eligibleCandidateCount: 0,
      published: false,
    };

    // --- Live Finnhub fetch (real GET, one per category) ------------------
    let fetched: NewsItem[] = [];
    try {
      fetched = await finnhub.fetchCategory(category);
    } catch (err) {
      catReport.skipReason = `finnhub_fetch_error: ${err instanceof Error ? err.message : String(err)}`;
      report.categories.push(catReport);
      continue;
    }
    catReport.fetchedCount = fetched.length;
    // Defense in depth: every item must genuinely be Finnhub-sourced.
    fetched = fetched.filter((i) => i.provider === "finnhub");

    // --- Live duplicate check (real GET); fail closed on error -----------
    let alreadyPublished: Set<string>;
    try {
      alreadyPublished = await fetchRecentlyPublishedUrls({
        api,
        channelId,
        botUserId: botId,
        limit: config.historyLookback,
      });
      catReport.duplicateCheckOk = true;
    } catch (err) {
      catReport.duplicateCheckOk = false;
      catReport.duplicateCheckError = err instanceof Error ? err.message : String(err);
      catReport.skipReason = "duplicate_check_failed_fail_closed";
      report.categories.push(catReport);
      console.log(`${category}: duplicate check FAILED -- failing closed, not publishing to this channel`);
      continue;
    }

    const deduped = dedupeItems(fetched, alreadyPublished);

    // Age filter only -- no premature cap, so selection (Part 8) can see
    // every genuinely fresh candidate, not just the chronologically-oldest.
    const floodAll = applyFloodControl(deduped, {
      maxAgeMinutes: config.maxAgeMinutes,
      maxPostsPerChannel: Math.max(deduped.length, 1),
    });
    catReport.staleCount = floodAll.rejectedAsStale.length;
    catReport.eligibleCandidateCount = floodAll.eligible.length;

    const best = selectBestCandidate(floodAll.eligible);
    if (!best) {
      catReport.skipReason = "no_qualifying_fresh_article";
      report.categories.push(catReport);
      console.log(`${category}: no qualifying fresh article this run -- publishing nothing here`);
      continue;
    }

    catReport.selected = {
      headline: best.headline,
      estimatedImpact: best.estimatedImpact,
      source: best.source,
      publishedAt: best.publishedAt,
      url: best.url,
      formattedPreview: formatNewsMessage(best),
    };

    // --- The actual write: real, unmodified publishCategory() pipeline ---
    const recordingApi = new RecordingApi(api);
    const result = await publishCategory(category, {
      api: recordingApi,
      providers: [new FixedItemProvider(category, best)],
      config,
    });

    if (result.duplicateCheckFailed) {
      catReport.skipReason = "duplicate_check_failed_on_final_pass";
      report.categories.push(catReport);
      continue;
    }
    if (result.published.length === 0) {
      catReport.skipReason = result.skipped[0]?.reason ?? "not_published_unknown_reason";
      report.categories.push(catReport);
      console.log(`${category}: not published (${catReport.skipReason})`);
      continue;
    }

    // Exactly one publish expected (cap=1, single candidate handed in).
    const created = recordingApi.lastCreated;
    if (!created) {
      catReport.skipReason = "internal_error_no_created_message_captured";
      report.categories.push(catReport);
      malformedStop = true;
      report.malformedStop = true;
      report.malformedDetail = {
        category,
        channelId,
        messageId: "(none captured)",
        problems: ["publishCategory reported a publish but no APIMessage was captured"],
      };
      break;
    }

    catReport.published = true;
    catReport.messageId = created.id;

    // --- Part 11: read-back validation -------------------------------
    const readBackProblems: string[] = [];
    let readBack: APIMessage;
    try {
      readBack = await api.getMessage(channelId, created.id);
    } catch (err) {
      readBackProblems.push(`getMessage failed: ${err instanceof Error ? err.message : String(err)}`);
      catReport.readBack = {
        ok: false,
        problems: readBackProblems,
        channelId,
        authorId: "",
        contentMatches: false,
        suppressEmbeds: false,
        hasEmbeds: false,
        pinned: false,
        mentionEveryone: false,
        mentionRolesCount: 0,
        mentionsCount: 0,
      };
      report.categories.push(catReport);
      malformedStop = true;
      report.malformedStop = true;
      report.malformedDetail = { category, channelId, messageId: created.id, problems: readBackProblems };
      break;
    }

    // Raw fields beyond this repo's minimal APIMessage type -- Discord's
    // real response includes these; read them defensively.
    const raw = readBack as APIMessage & {
      mention_everyone?: boolean;
      mention_roles?: string[];
      mentions?: unknown[];
    };

    const expectedContent = formatNewsMessage(best);
    const contentMatches = raw.content === expectedContent;
    const authorMatches = raw.author.id === botId;
    const channelMatches = raw.channel_id === channelId;
    const suppressEmbeds = ((raw.flags ?? 0) & MESSAGE_FLAGS.SUPPRESS_EMBEDS) !== 0;
    const hasEmbeds = (raw.embeds ?? []).length > 0;
    const isPinned = raw.pinned === true;
    const mentionEveryone = raw.mention_everyone === true;
    const mentionRolesCount = (raw.mention_roles ?? []).length;
    const mentionsCount = (raw.mentions ?? []).length;

    if (!contentMatches) readBackProblems.push("content did not exactly match the expected formatted message");
    if (!authorMatches) readBackProblems.push(`author.id ${raw.author.id} does not match bot id ${botId}`);
    if (!channelMatches) readBackProblems.push(`channel_id ${raw.channel_id} does not match target channel ${channelId}`);
    if (!suppressEmbeds) readBackProblems.push("SUPPRESS_EMBEDS flag was not set");
    if (hasEmbeds) readBackProblems.push(`message has ${(raw.embeds ?? []).length} embed(s), expected 0`);
    if (isPinned) readBackProblems.push("message was unexpectedly pinned");
    if (mentionEveryone) readBackProblems.push("mention_everyone was true");
    if (mentionRolesCount > 0) readBackProblems.push(`mention_roles had ${mentionRolesCount} entr(y/ies)`);
    if (mentionsCount > 0) readBackProblems.push(`mentions had ${mentionsCount} entr(y/ies)`);

    catReport.readBack = {
      ok: readBackProblems.length === 0,
      problems: readBackProblems,
      channelId: raw.channel_id,
      authorId: raw.author.id,
      contentMatches,
      suppressEmbeds,
      hasEmbeds,
      pinned: isPinned,
      mentionEveryone,
      mentionRolesCount,
      mentionsCount,
    };

    if (readBackProblems.length > 0) {
      console.error(`${category}: MALFORMED message #${created.id} -- ${readBackProblems.join("; ")}`);
      malformedStop = true;
      report.malformedStop = true;
      report.malformedDetail = { category, channelId, messageId: created.id, problems: readBackProblems };
      report.categories.push(catReport);
      break; // Part 12: stop further publishing; do not auto-delete.
    }

    console.log(`${category}: PUBLISHED message #${created.id} in #${channelId} -- read-back verified OK`);

    // --- Part 13: post-publication duplicate recheck (read-only) ---------
    try {
      const after = await fetchRecentlyPublishedUrls({
        api,
        channelId,
        botUserId: botId,
        limit: config.historyLookback,
      });
      catReport.duplicateRecheckOk = after.has(normalizeArticleUrl(best.url));
    } catch (err) {
      catReport.duplicateRecheckOk = false;
      console.error(`${category}: duplicate recheck read failed -- ${String(err)}`);
    }

    // --- Pinned-introduction integrity ------------------------------------
    try {
      const afterPin = await readPinState(api, channelId, config.historyLookback);
      const before = pinStateBefore.get(category);
      catReport.pinnedIntegrityOk =
        !!before &&
        before.pinnedIds.length === afterPin.pinnedIds.length &&
        before.pinnedIds.every((id) => afterPin.pinnedContentById[id] === before.pinnedContentById[id]);
    } catch (err) {
      catReport.pinnedIntegrityOk = false;
      console.error(`${category}: pinned-integrity read failed -- ${String(err)}`);
    }

    report.categories.push(catReport);
  }

  writeReport(report);

  const discordCounts = requestCounts["discord.com"] ?? { GET: 0, nonGetMethods: [] };
  const finnhubCounts = requestCounts["finnhub.io"] ?? { GET: 0, nonGetMethods: [] };
  const unexpectedWrites = discordCounts.nonGetMethods.filter((m) => m !== "POST");

  console.log(`\nDiscord GET: ${discordCounts.GET}`);
  console.log(`Discord POST: ${discordCounts.nonGetMethods.filter((m) => m === "POST").length}`);
  console.log(`Discord PATCH/PUT/DELETE: ${unexpectedWrites.length}`);
  console.log(`Finnhub GET: ${finnhubCounts.GET}`);
  console.log("Discord writes:", JSON.stringify(discordWrites, null, 2));

  if (unexpectedWrites.length > 0) {
    console.error("\nSAFETY FAILURE -- UNEXPECTED DISCORD WRITE DURING CONTROLLED LIVE POST");
    console.error(JSON.stringify(discordWrites, null, 2));
    process.exitCode = 1;
    return;
  }

  if (report.malformedStop) {
    console.error("\nNOT READY -- CORRECTION REQUIRED (malformed message detected, see report)");
    process.exitCode = 1;
    return;
  }

  const anyPublished = report.categories.some((c) => c.published);
  if (anyPublished) {
    console.log("\nCONTROLLED LIVE TEST SUCCESSFUL -- READY FOR SCHEDULED PRODUCTION");
  } else {
    console.log("\nCONTROLLED LIVE TEST PENDING -- NO QUALIFYING FRESH ARTICLE");
  }
}

main().catch((err) => {
  console.error("fatal error:", err instanceof Error ? err.stack : err);
  process.exitCode = 1;
});
