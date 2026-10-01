#!/usr/bin/env -S npx tsx
/**
 * Phase 3H.2R -- real Discord READ validation + real Finnhub data dry run.
 *
 * Safety layers, all independently enforced:
 *  1. loadNewsConfig() reads NEWS_DRY_RUN/NEWS_PUBLISH_ENABLED from .env
 *     (both must already be true/false respectively -- this script does not
 *     change them) and is additionally forced to dryRun:true here regardless.
 *  2. The real DiscordClient is constructed with dryRun:true, which throws
 *     DryRunWriteError before any network I/O for a non-GET request.
 *  3. isProviderPublishable() in the real publishCategory() short-circuits
 *     everything to "skipped" while dryRun is true, so createMessage is
 *     never even called.
 *
 * This script never sends, edits, deletes, pins, or unpins anything, and
 * never prints DISCORD_BOT_TOKEN or FINNHUB_API_KEY.
 *
 * Run with: npx tsx scripts/phase3h2r_live_dryrun.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { NEWS_CHANNELS, NEWS_CATEGORIES, type NewsCategory } from "../src/config/bullhaus.js";
import { DiscordClient, DiscordAPIError } from "../src/discord/client.js";
import { DiscordEndpoints } from "../src/discord/endpoints.js";
import type { APIMessage } from "../src/discord/types.js";
import { loadNewsConfig } from "../src/news/config.js";
import { formatNewsMessage } from "../src/news/format.js";
import { FinnhubProvider } from "../src/news/providers/finnhub_provider.js";
import type { NewsProvider } from "../src/news/provider.js";
import { publishCategory, type PublishCategoryResult } from "../src/news/publisher.js";
import type { NewsItem } from "../src/news/types.js";

/** One representative item per distinct impact level actually present (order of first appearance). */
function pickRepresentative(items: readonly NewsItem[]): NewsItem[] {
  const byLevel = new Map<string, NewsItem>();
  for (const item of items) {
    if (!byLevel.has(item.estimatedImpact)) byLevel.set(item.estimatedImpact, item);
  }
  return [...byLevel.values()];
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = join(__dirname, "..", "reports", "phase3h2r_data.json");

// --- Load .env into process.env (this repo's tooling never uses dotenv; the
// Owner normally sources it into the shell -- this script does the same
// thing for itself only, without ever printing the parsed values). ---------
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

// --- Instrumented fetch: counts real requests by method and host, never
// logs a URL's query string (which would leak the Finnhub token). ----------
interface HostCounts {
  GET: number;
  nonGetMethods: string[];
}
const requestCounts: Record<string, HostCounts> = {};

function record(hostname: string, method: string): void {
  const entry = (requestCounts[hostname] ??= { GET: 0, nonGetMethods: [] });
  if (method === "GET") entry.GET += 1;
  else entry.nonGetMethods.push(method);
}

const instrumentedFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? "GET").toUpperCase();
  let hostname = "unknown";
  try {
    hostname = new URL(url).hostname;
  } catch {
    // ignore
  }
  record(hostname, method);
  return fetch(input, init);
};

// --- Capture the raw (pre-dedup, pre-flood) items a real fetch returned, so
// the report can show classification distribution without a second live
// Finnhub request. ----------------------------------------------------------
class CapturingProvider implements NewsProvider {
  readonly id: string;
  lastFetched: NewsItem[] = [];
  constructor(private readonly inner: NewsProvider) {
    this.id = inner.id;
  }
  async fetchCategory(category: NewsCategory): Promise<NewsItem[]> {
    const items = await this.inner.fetchCategory(category);
    this.lastFetched = items;
    return items;
  }
}

interface ChannelCheck {
  category: NewsCategory;
  channelId: string;
  accessible: boolean;
  messageCount?: number;
  pinnedCount?: number;
  error?: string;
}

interface CategoryReport {
  category: NewsCategory;
  channelId: string;
  fetchedCount: number;
  afterDedupCount: number;
  rejectedAsStaleCount: number;
  rejectedByLimitCount: number;
  publishedCount: number;
  duplicateCheckFailed: boolean;
  providerErrors: string[];
  impactDistribution: { low: number; medium: number; high: number };
  sampleItems: Array<{
    headline: string;
    estimatedImpact: string;
    impactSource: string;
    source: string;
    /** Illustrative formatting example from real data -- NOT necessarily age-eligible this run. */
    formattedExample: string;
  }>;
  skippedSample: Array<{ reason: string; preview: string }>;
}

async function main(): Promise<void> {
  const config = { ...loadNewsConfig(), dryRun: true }; // forced true regardless of .env, per Part 18/19
  const token = process.env["DISCORD_BOT_TOKEN"];

  const report: {
    generatedAt: string;
    config: { providers: string[]; dryRun: boolean; publishEnabled: boolean; finnhubLicenseApproved: boolean };
    auth: { ok: boolean; botId?: string; botUsername?: string; error?: string };
    channelChecks: ChannelCheck[];
    categories: CategoryReport[];
    requestCounts: Record<string, HostCounts>;
    stoppedEarly: boolean;
  } = {
    generatedAt: new Date().toISOString(),
    config: {
      providers: config.providers,
      dryRun: config.dryRun,
      publishEnabled: config.publishEnabled,
      finnhubLicenseApproved: config.finnhubLicenseApproved,
    },
    auth: { ok: false },
    channelChecks: [],
    categories: [],
    requestCounts,
    stoppedEarly: false,
  };

  if (!token) {
    report.auth = { ok: false, error: "DISCORD_BOT_TOKEN is not set" };
    report.stoppedEarly = true;
    writeReport(report);
    console.error("STOP: DISCORD_BOT_TOKEN is not set. Not calling Discord or Finnhub.");
    process.exitCode = 1;
    return;
  }

  const client = new DiscordClient({
    token,
    apiVersion: process.env["DISCORD_API_VERSION"] ?? "v10",
    dryRun: true, // independent safety layer -- see file header
    fetchFn: instrumentedFetch,
  });
  const api = new DiscordEndpoints(client);

  // --- Section 2: Discord credential preflight (GET only) -----------------
  try {
    const me = await api.getCurrentUser();
    report.auth = { ok: true, botId: me.id, botUsername: me.username };
    console.log(`Discord auth OK: bot user id=${me.id} username=${me.username}`);
  } catch (err) {
    const status = err instanceof DiscordAPIError ? err.status : undefined;
    report.auth = { ok: false, error: err instanceof Error ? err.message : String(err) };
    report.stoppedEarly = true;
    writeReport(report);
    console.error(`STOP: Discord authentication failed${status ? ` (HTTP ${status})` : ""}.`);
    console.error("Not continuing to channel reads or the Finnhub live-data test.");
    process.exitCode = 1;
    return;
  }

  // --- Section 2/15: read access + pinned-intro check per News channel ----
  for (const category of NEWS_CATEGORIES) {
    const channelId = NEWS_CHANNELS[category];
    try {
      const messages: APIMessage[] = await api.listMessages(channelId, {
        limit: config.historyLookback,
      });
      const pinnedCount = messages.filter((m) => m.pinned).length;
      report.channelChecks.push({
        category,
        channelId,
        accessible: true,
        messageCount: messages.length,
        pinnedCount,
      });
      console.log(
        `Channel #${channelId} (${category}): accessible, ${messages.length} messages read, ${pinnedCount} pinned`,
      );
    } catch (err) {
      report.channelChecks.push({
        category,
        channelId,
        accessible: false,
        error: err instanceof Error ? err.message : String(err),
      });
      console.error(`Channel #${channelId} (${category}): READ FAILED -- ${String(err)}`);
    }
  }

  // --- Section 16: real Finnhub fetch through the full production pipeline
  const finnhub = new FinnhubProvider({ fetchFn: instrumentedFetch });
  for (const category of NEWS_CATEGORIES) {
    const capturing = new CapturingProvider(finnhub);
    let result: PublishCategoryResult;
    try {
      result = await publishCategory(category, { api, providers: [capturing], config });
    } catch (err) {
      console.error(`publishCategory(${category}) threw unexpectedly: ${String(err)}`);
      continue;
    }

    const dist = { low: 0, medium: 0, high: 0 };
    for (const item of capturing.lastFetched) dist[item.estimatedImpact] += 1;

    report.categories.push({
      category,
      channelId: result.channelId,
      fetchedCount: result.fetchedCount,
      afterDedupCount: result.afterDedupCount,
      rejectedAsStaleCount: result.rejectedAsStaleCount,
      rejectedByLimitCount: result.rejectedByLimitCount,
      publishedCount: result.published.length,
      duplicateCheckFailed: result.duplicateCheckFailed,
      providerErrors: result.providerErrors,
      impactDistribution: dist,
      sampleItems: pickRepresentative(capturing.lastFetched).map((i) => ({
        headline: i.headline,
        estimatedImpact: i.estimatedImpact,
        impactSource: i.impactSource,
        source: i.source,
        formattedExample: formatNewsMessage(i),
      })),
      skippedSample: result.skipped.slice(0, 2).map((s) => ({ reason: s.reason, preview: s.preview })),
    });

    console.log(
      `${category}: fetched=${result.fetchedCount} after_dedup=${result.afterDedupCount} ` +
        `published=${result.published.length} duplicateCheckFailed=${result.duplicateCheckFailed} ` +
        `impact low/med/high=${dist.low}/${dist.medium}/${dist.high}`,
    );
  }

  writeReport(report);

  const totalGet = Object.values(requestCounts).reduce((n, h) => n + h.GET, 0);
  const totalNonGet = Object.values(requestCounts).reduce((n, h) => n + h.nonGetMethods.length, 0);
  console.log(`\nTotal real GET requests: ${totalGet}`);
  console.log(`Total real non-GET requests: ${totalNonGet}`);
  console.log("By host:", JSON.stringify(requestCounts, null, 2));
}

function writeReport(data: unknown): void {
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(data, null, 2), "utf8");
  console.log(`\nWrote ${OUT_FILE}`);
}

main().catch((err) => {
  console.error("fatal error:", err instanceof Error ? err.stack : err);
  process.exitCode = 1;
});
