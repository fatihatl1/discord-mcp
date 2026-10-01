/**
 * Orchestrates one publish pass: fetch -> dedup -> flood control -> approval
 * gate -> (maybe) send. A failure in one category's provider or duplicate
 * check never stops another category (Part L), but a failed duplicate check
 * DOES stop publication into that category's own channel (Part J/L) rather
 * than assuming Discord history is empty.
 */

import { newsChannelId, type NewsCategory } from "../config/bullhaus.js";
import { MESSAGE_FLAGS } from "../discord/types.js";
import { log } from "../logging.js";
import { isProviderPublishable, skipReason, type NewsConfig } from "./config.js";
import { dedupeItems, fetchRecentlyPublishedUrls } from "./dedup.js";
import type { NewsDiscordApi } from "./discord_api.js";
import { applyFloodControl } from "./flood_control.js";
import { formatNewsMessage } from "./format.js";
import type { NewsProvider } from "./provider.js";
import type { NewsItem } from "./types.js";

export interface SkippedItem {
  item: NewsItem;
  reason: string;
  /** The exact message that would have been sent, for dry-run/preview display. */
  preview: string;
}

export interface PublishCategoryResult {
  category: NewsCategory;
  channelId: string;
  fetchedCount: number;
  afterDedupCount: number;
  rejectedAsStaleCount: number;
  rejectedByLimitCount: number;
  published: NewsItem[];
  skipped: SkippedItem[];
  providerErrors: string[];
  duplicateCheckFailed: boolean;
  dryRun: boolean;
}

export interface PublishOptions {
  api: NewsDiscordApi;
  providers: readonly NewsProvider[];
  config: NewsConfig;
  now?: () => Date;
}

export async function publishCategory(
  category: NewsCategory,
  opts: PublishOptions,
): Promise<PublishCategoryResult> {
  const channelId = newsChannelId(category);
  const providerErrors: string[] = [];

  const fetched: NewsItem[] = [];
  for (const provider of opts.providers) {
    try {
      fetched.push(...(await provider.fetchCategory(category)));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      providerErrors.push(`${provider.id}: ${message}`);
      log.warn("news provider failed for category", {
        provider: provider.id,
        category,
        error: message,
      });
    }
  }

  let duplicateCheckFailed = false;
  let alreadyPublished = new Set<string>();
  try {
    const me = await opts.api.getCurrentUser();
    alreadyPublished = await fetchRecentlyPublishedUrls({
      api: opts.api,
      channelId,
      botUserId: me.id,
      limit: opts.config.historyLookback,
    });
  } catch (err) {
    duplicateCheckFailed = true;
    const message = err instanceof Error ? err.message : String(err);
    providerErrors.push(`duplicate check failed: ${message}`);
    log.warn("news duplicate check failed; skipping publication for this channel", {
      category,
      channelId,
      error: message,
    });
  }

  // A failed duplicate check must block publication into this channel
  // entirely -- never fall back to "assume nothing was published yet".
  const deduped = duplicateCheckFailed ? [] : dedupeItems(fetched, alreadyPublished);

  const flood = applyFloodControl(deduped, {
    maxAgeMinutes: opts.config.maxAgeMinutes,
    maxPostsPerChannel: opts.config.maxPostsPerChannel,
    now: opts.now,
  });

  const published: NewsItem[] = [];
  const skipped: SkippedItem[] = [];

  if (duplicateCheckFailed) {
    for (const item of fetched) {
      skipped.push({
        item,
        reason: "duplicate_check_failed",
        preview: formatNewsMessage(item),
      });
    }
  } else {
    for (const item of flood.eligible) {
      const preview = formatNewsMessage(item);
      if (isProviderPublishable(item.provider, opts.config)) {
        await opts.api.createMessage(channelId, {
          content: preview,
          flags: MESSAGE_FLAGS.SUPPRESS_EMBEDS,
        });
        published.push(item);
      } else {
        skipped.push({ item, reason: skipReason(item.provider, opts.config), preview });
      }
    }
  }

  return {
    category,
    channelId,
    fetchedCount: fetched.length,
    afterDedupCount: deduped.length,
    rejectedAsStaleCount: flood.rejectedAsStale.length,
    rejectedByLimitCount: flood.rejectedByLimit.length,
    published,
    skipped,
    providerErrors,
    duplicateCheckFailed,
    dryRun: opts.config.dryRun,
  };
}

/** Runs publishCategory across all three News categories, independently. */
export async function runNewsWorker(
  opts: PublishOptions,
): Promise<PublishCategoryResult[]> {
  const categories: NewsCategory[] = ["general", "forex", "crypto"];
  const results: PublishCategoryResult[] = [];
  for (const category of categories) {
    results.push(await publishCategory(category, opts));
  }
  return results;
}
