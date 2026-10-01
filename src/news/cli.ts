#!/usr/bin/env node
/**
 * Standalone News Worker entrypoint -- independent of Claude Desktop/MCP.
 * Safe by default: NEWS_DRY_RUN defaults to true and NEWS_PUBLISH_ENABLED
 * defaults to false, so running this with no configuration at all previews
 * formatted messages and sends nothing.
 *
 *   npm run news:dry   -- fully offline, Mock Provider, no credentials needed
 *   npm run news       -- respects env config; still dry-run unless every
 *                          safety flag below is explicitly satisfied
 */

import { DiscordClient } from "../discord/client.js";
import { DiscordEndpoints } from "../discord/endpoints.js";
import { configureLogging, log } from "../logging.js";
import { loadNewsConfig, type NewsConfig } from "./config.js";
import type { NewsDiscordApi } from "./discord_api.js";
import { createOfflineNewsApi } from "./offline_api.js";
import { FinnhubProvider } from "./providers/finnhub_provider.js";
import { MockNewsProvider } from "./providers/mock_provider.js";
import { OfficialRssProvider } from "./providers/official_rss_provider.js";
import type { NewsProvider } from "./provider.js";
import { runNewsWorker, type PublishCategoryResult } from "./publisher.js";

function buildProviders(names: readonly string[]): NewsProvider[] {
  const providers: NewsProvider[] = [];
  for (const name of names) {
    switch (name) {
      case "mock":
        providers.push(new MockNewsProvider());
        break;
      case "finnhub":
        providers.push(new FinnhubProvider());
        break;
      case "official_rss":
        providers.push(new OfficialRssProvider());
        break;
      default:
        break;
    }
  }
  return providers.length > 0 ? providers : [new MockNewsProvider()];
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function printResult(result: PublishCategoryResult): void {
  process.stdout.write(
    `\n=== ${result.category.toUpperCase()} news (#${result.channelId}) ===\n`,
  );
  process.stdout.write(
    `fetched=${result.fetchedCount} after_dedup=${result.afterDedupCount} ` +
      `stale=${result.rejectedAsStaleCount} over_limit=${result.rejectedByLimitCount}\n`,
  );
  if (result.duplicateCheckFailed) {
    process.stdout.write(
      "duplicate check FAILED -- publication skipped for this channel this run\n",
    );
  }
  for (const err of result.providerErrors) {
    process.stdout.write(`  provider error: ${err}\n`);
  }
  for (const item of result.published) {
    process.stdout.write(`  PUBLISHED [${item.provider}] ${item.headline}\n`);
  }
  for (const skip of result.skipped) {
    process.stdout.write(`  SKIPPED (${skip.reason}) [${skip.item.provider}] ${skip.item.headline}\n`);
    process.stdout.write(`${indent(skip.preview, "      ")}\n`);
  }
  if (result.published.length === 0 && result.skipped.length === 0) {
    process.stdout.write("  (nothing eligible this run)\n");
  }
}

async function buildApi(offline: boolean, config: NewsConfig): Promise<NewsDiscordApi> {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (offline || !token) {
    if (!config.dryRun) {
      process.stderr.write(
        "news worker: refusing to run offline with NEWS_DRY_RUN=false. Set a " +
          "real DISCORD_BOT_TOKEN, or leave dry-run on.\n",
      );
      process.exit(1);
    }
    log.info("news worker running offline: no Discord token, preview only");
    return createOfflineNewsApi();
  }

  const client = new DiscordClient({
    token,
    apiVersion: process.env["DISCORD_API_VERSION"] ?? "v10",
    // Defense in depth: even if a future code path forgot the config check,
    // the HTTP client itself still refuses every write while dry-run holds.
    dryRun: config.dryRun,
  });
  return new DiscordEndpoints(client);
}

async function main(): Promise<void> {
  const offline = process.argv.includes("--offline");
  const config = loadNewsConfig();

  configureLogging({
    level: process.env["LOG_LEVEL"] ?? "info",
    redact: [process.env["DISCORD_BOT_TOKEN"], process.env["FINNHUB_API_KEY"]],
  });

  const api = await buildApi(offline, config);

  if (config.dryRun) {
    log.info("NEWS_DRY_RUN active: no Discord message will be sent this run");
  }
  if (!config.publishEnabled) {
    log.info("NEWS_PUBLISH_ENABLED=false: live publication stays disabled regardless of dry-run");
  }

  const providers = buildProviders(config.providers);
  const results = await runNewsWorker({ api, providers, config });

  process.stdout.write("\nBULLHAUS News Worker run summary\n");
  process.stdout.write(
    `providers=${config.providers.join(",")} dry_run=${config.dryRun} ` +
      `publish_enabled=${config.publishEnabled} finnhub_license_approved=${config.finnhubLicenseApproved}\n`,
  );
  for (const result of results) printResult(result);
}

main().catch((err) => {
  log.error("news worker fatal error", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exitCode = 1;
});
