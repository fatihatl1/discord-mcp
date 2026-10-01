/**
 * Duplicate prevention (Part J). Deliberately a BOUNDED mechanism -- it only
 * ever looks at the most recent `limit` messages in a channel, not a
 * permanent historical database. The interface is narrow enough that a
 * persistent store could sit behind it later without callers changing.
 */

import type { NewsDiscordApi } from "./discord_api.js";
import type { NewsItem } from "./types.js";

const ARTICLE_LINK_RE = /\[Read article\]\((https?:\/\/[^\s)]+)\)/;

export function normalizeArticleUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return raw.trim();
  }
}

export interface FetchRecentPublicationsOptions {
  api: NewsDiscordApi;
  channelId: string;
  /** This bot's own user id -- only its own news posts count as "already published". */
  botUserId: string;
  /** Default 100, matching Discord's own per-request page size. */
  limit?: number;
}

/**
 * Scans recent channel history for article links this bot has already
 * posted. Never treats a pinned message as a news post (the pinned
 * introductory message is explicitly out of scope, per Part J) and is never
 * asked to delete or alter anything it finds.
 */
export async function fetchRecentlyPublishedUrls(
  opts: FetchRecentPublicationsOptions,
): Promise<Set<string>> {
  const limit = opts.limit ?? 100;
  const messages = await opts.api.listMessages(opts.channelId, { limit });
  const urls = new Set<string>();
  for (const message of messages) {
    if (message.author.id !== opts.botUserId) continue;
    if (message.pinned) continue;
    const match = ARTICLE_LINK_RE.exec(message.content);
    if (match?.[1]) urls.add(normalizeArticleUrl(match[1]));
  }
  return urls;
}

/**
 * Drops items already published (per Discord history) and items that
 * duplicate each other within the same provider response.
 */
export function dedupeItems(
  items: readonly NewsItem[],
  alreadyPublished: ReadonlySet<string>,
): NewsItem[] {
  const seenThisBatch = new Set<string>();
  const out: NewsItem[] = [];
  for (const item of items) {
    const key = normalizeArticleUrl(item.url);
    if (alreadyPublished.has(key)) continue;
    if (seenThisBatch.has(key)) continue;
    seenThisBatch.add(key);
    out.push(item);
  }
  return out;
}
