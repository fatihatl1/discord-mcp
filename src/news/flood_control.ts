/** Publication safeguards (Part K): age filter, chronological order, volume cap. */

import type { NewsItem } from "./types.js";

export interface FloodControlOptions {
  /** Default 60. Items older than this (by publishedAt) are dropped. */
  maxAgeMinutes: number;
  /** Default 3. Caps how many items are eligible per call (== per channel per run). */
  maxPostsPerChannel: number;
  now?: () => Date;
}

export interface FloodControlResult {
  /** Oldest-first, capped at maxPostsPerChannel -- safe to publish in this order. */
  eligible: NewsItem[];
  rejectedAsStale: NewsItem[];
  /** Otherwise-eligible items dropped only because the per-channel cap was reached. */
  rejectedByLimit: NewsItem[];
}

export function applyFloodControl(
  items: readonly NewsItem[],
  opts: FloodControlOptions,
): FloodControlResult {
  const nowMs = (opts.now ?? (() => new Date()))().getTime();
  const maxAgeMs = opts.maxAgeMinutes * 60_000;

  const fresh: NewsItem[] = [];
  const rejectedAsStale: NewsItem[] = [];
  for (const item of items) {
    const ageMs = nowMs - Date.parse(item.publishedAt);
    if (ageMs <= maxAgeMs) fresh.push(item);
    else rejectedAsStale.push(item);
  }

  // Chronological (oldest first) so a channel reads as a timeline instead of
  // arriving in whatever order the provider happened to return them, and so
  // a sudden backlog is capped from the oldest end rather than skipping
  // straight to only the newest item.
  fresh.sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));

  const eligible = fresh.slice(0, opts.maxPostsPerChannel);
  const rejectedByLimit = fresh.slice(opts.maxPostsPerChannel);

  return { eligible, rejectedAsStale, rejectedByLimit };
}
