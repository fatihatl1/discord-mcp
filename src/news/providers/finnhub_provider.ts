/**
 * Finnhub Market News API adapter (https://finnhub.io/docs/api/market-news).
 * GET /news?category={general|forex|crypto}&token={apiKey}
 *
 * IMPORTANT -- licensing: Finnhub is not automatically cleared for public
 * BULLHAUS redistribution just because the free tier is in use. The
 * publish-side approval gate (NEWS_LICENSE_APPROVED / NEWS_PUBLISH_ENABLED,
 * see config.ts) must be satisfied independently of anything in this file --
 * this adapter only fetches and normalizes, it does not decide whether it is
 * allowed to publish.
 */

import type { NewsCategory } from "../../config/bullhaus.js";
import { log } from "../../logging.js";
import type { NewsProvider } from "../provider.js";
import { validateNewsItem, type NewsItem } from "../types.js";

export interface FinnhubProviderOptions {
  /** Defaults to process.env.FINNHUB_API_KEY. Never hard-code a key here. */
  apiKey?: string | undefined;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = "https://finnhub.io/api/v1";
const DEFAULT_TIMEOUT_MS = 10_000;

interface RawFinnhubItem {
  id?: unknown;
  headline?: unknown;
  source?: unknown;
  url?: unknown;
  datetime?: unknown;
  summary?: unknown;
  /** Comma-separated related tickers. Usually empty for Market News. */
  related?: unknown;
}

export class FinnhubProvider implements NewsProvider {
  readonly id = "finnhub";
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: FinnhubProviderOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env["FINNHUB_API_KEY"];
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async fetchCategory(category: NewsCategory): Promise<NewsItem[]> {
    if (!this.apiKey) {
      log.warn("finnhub provider: FINNHUB_API_KEY is not set; returning no items", {
        category,
      });
      return [];
    }

    const url =
      `${this.baseUrl}/news?category=${encodeURIComponent(category)}` +
      `&token=${encodeURIComponent(this.apiKey)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchFn(url, { signal: controller.signal });
    } catch (err) {
      log.warn("finnhub provider: request failed", {
        category,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 429) {
      log.warn("finnhub provider: rate limited by Finnhub", { category });
      return [];
    }
    if (!res.ok) {
      log.warn("finnhub provider: HTTP error", { category, status: res.status });
      return [];
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      log.warn("finnhub provider: response was not valid JSON", { category });
      return [];
    }
    if (!Array.isArray(body)) {
      log.warn("finnhub provider: unexpected response shape (expected an array)", {
        category,
      });
      return [];
    }

    const items: NewsItem[] = [];
    const seenIds = new Set<string>();
    for (const raw of body) {
      const item = normalizeFinnhubItem(raw, category, this.id);
      if (!item) continue;
      if (seenIds.has(item.externalId)) continue; // duplicate within this response
      seenIds.add(item.externalId);
      items.push(item);
    }
    return items;
  }
}

function normalizeFinnhubItem(
  raw: unknown,
  category: NewsCategory,
  providerId: string,
): NewsItem | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const r = raw as RawFinnhubItem;

  if (typeof r.id !== "number" && typeof r.id !== "string") return undefined;
  if (typeof r.headline !== "string") return undefined;
  if (typeof r.url !== "string") return undefined;
  if (typeof r.source !== "string") return undefined;
  if (typeof r.datetime !== "number" || !Number.isFinite(r.datetime)) return undefined;

  const relatedSymbols =
    typeof r.related === "string" && r.related.trim()
      ? r.related
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : undefined;

  try {
    return validateNewsItem({
      externalId: `finnhub-${String(r.id)}`,
      provider: providerId,
      category,
      headline: r.headline,
      source: r.source,
      url: r.url,
      publishedAt: new Date(r.datetime * 1000).toISOString(),
      summary: typeof r.summary === "string" ? r.summary : undefined,
      relatedSymbols,
    });
  } catch (err) {
    log.warn("finnhub provider: dropping invalid item", {
      category,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}
