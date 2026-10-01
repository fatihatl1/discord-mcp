/**
 * Fetches configured, Owner-approved official RSS/Atom feeds and normalizes
 * their entries into NewsItems. Only sources that are both enabled AND
 * approved (rss/sources.ts) are ever fetched -- an unreviewed feed is never
 * touched, live or in tests, unless a test explicitly overrides the source
 * list.
 */

import type { NewsCategory } from "../../config/bullhaus.js";
import { log } from "../../logging.js";
import { parseFeed, type ParsedFeedItem } from "../rss/parser.js";
import { enabledApprovedSources, type RssSourceConfig } from "../rss/sources.js";
import type { NewsProvider } from "../provider.js";
import { validateNewsItem, type NewsItem } from "../types.js";

export interface OfficialRssProviderOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  /** Overrides the module-level RSS_SOURCES list -- tests only. */
  sources?: readonly RssSourceConfig[];
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 5_000_000;

export class OfficialRssProvider implements NewsProvider {
  readonly id = "official_rss";
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly sourcesOverride: readonly RssSourceConfig[] | undefined;

  constructor(opts: OfficialRssProviderOptions = {}) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxResponseBytes = opts.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.sourcesOverride = opts.sources;
  }

  async fetchCategory(category: NewsCategory): Promise<NewsItem[]> {
    const candidates = this.sourcesOverride ?? enabledApprovedSources(category);
    // Even with an override (tests), never fetch a source that isn't both
    // enabled and approved for THIS category -- the gate is never bypassed.
    const sources = candidates.filter(
      (s) => s.category === category && s.enabled && s.approved,
    );

    const items: NewsItem[] = [];
    for (const source of sources) {
      try {
        items.push(...(await this.fetchOneSource(source)));
      } catch (err) {
        // One bad source must never block the others.
        log.warn("official rss provider: source failed", {
          source: source.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return items;
  }

  private async fetchOneSource(source: RssSourceConfig): Promise<NewsItem[]> {
    const xml = await this.download(source);
    const parsed = parseFeed(xml);

    const items: NewsItem[] = [];
    for (const entry of parsed) {
      if (!passesFilter(entry, source.filter)) continue;
      if (!entry.publishedAt) {
        log.warn("official rss provider: dropping item with missing/invalid date", {
          source: source.id,
          entry: entry.id,
        });
        continue;
      }
      try {
        items.push(
          validateNewsItem({
            externalId: `${source.id}:${entry.id}`,
            provider: `official_rss:${source.id}`,
            category: source.category,
            headline: entry.title,
            source: source.institution,
            url: entry.link,
            publishedAt: entry.publishedAt,
          }),
        );
      } catch (err) {
        log.warn("official rss provider: dropping invalid item", {
          source: source.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return items;
  }

  private async download(source: RssSourceConfig): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(source.url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} fetching ${source.url}`);
      }
      const contentLength = res.headers.get("content-length");
      if (contentLength && Number(contentLength) > this.maxResponseBytes) {
        throw new Error(
          `response too large (${contentLength} bytes, limit ${this.maxResponseBytes})`,
        );
      }
      return await readLimited(res, this.maxResponseBytes);
    } finally {
      clearTimeout(timer);
    }
  }
}

function passesFilter(entry: ParsedFeedItem, filter: RssSourceFilterLike): boolean {
  if (!filter?.keywords || filter.keywords.length === 0) return true;
  const haystack = `${entry.title} ${entry.description ?? ""}`.toLowerCase();
  return filter.keywords.some((k) => haystack.includes(k.toLowerCase()));
}

type RssSourceFilterLike = RssSourceConfig["filter"];

/** Reads the response body with a hard byte cap, aborting once exceeded. */
async function readLimited(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    if (text.length > maxBytes) {
      throw new Error(`response too large (${text.length} bytes, limit ${maxBytes})`);
    }
    return text;
  }
  const decoder = new TextDecoder();
  let result = "";
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`response too large (>${maxBytes} bytes)`);
    }
    result += decoder.decode(value, { stream: true });
  }
  result += decoder.decode();
  return result;
}
