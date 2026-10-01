/**
 * The normalized news item every provider must produce. Providers translate
 * their own response shape into this and nothing else flows downstream, so
 * the formatter/dedup/flood-control/publisher code never has to know which
 * provider an item came from.
 */

import type { NewsCategory } from "../config/bullhaus.js";
import { classifyImpact, type EstimatedImpact, type ImpactSource } from "./impact.js";

export type { NewsCategory } from "../config/bullhaus.js";
export type { EstimatedImpact, ImpactSource } from "./impact.js";

export interface NewsItem {
  /** Id assigned by the originating provider/source; unique within it. */
  externalId: string;
  /** Which provider (and, for RSS, which configured source) produced this. */
  provider: string;
  category: NewsCategory;
  headline: string;
  /** Original publisher/source -- never invented, always preserved as-is. */
  source: string;
  /** ISO-8601 UTC timestamp. */
  publishedAt: string;
  url: string;
  /** Optional short summary. Never rendered into the published message (see format.ts). */
  summary?: string;
  /** Provider-supplied related tickers, when available (e.g. Finnhub's `related`). */
  relatedSymbols?: readonly string[];
  /**
   * BULLHAUS-owned Low/Medium/High estimate (see impact.ts). Never an
   * authoritative, provider-issued rating unless impactSource is "provider".
   */
  estimatedImpact: EstimatedImpact;
  /** "bullhaus_heuristic" for every current provider; "provider" is reserved
   * for a future source that supplies a genuine impact field -- see
   * validateNewsItem, which never overwrites that case with the heuristic. */
  impactSource: ImpactSource;
}

export class InvalidNewsItemError extends Error {
  constructor(reason: string) {
    super(`Invalid news item: ${reason}`);
    this.name = "InvalidNewsItemError";
  }
}

const MAX_HEADLINE_LENGTH = 512;
const MAX_SOURCE_LENGTH = 200;
const NEWS_CATEGORY_SET = new Set<string>(["general", "forex", "crypto"]);

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isValidArticleUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" || parsed.protocol === "http:";
}

/**
 * Candidate fields a provider assembled from its own response. Validated and
 * normalized into a NewsItem, or rejected with InvalidNewsItemError -- never
 * silently coerced into something the provider didn't actually say.
 */
export interface NewsItemCandidate {
  externalId: string;
  provider: string;
  category: string;
  headline: string;
  source: string;
  publishedAt: string;
  url: string;
  summary?: string | undefined;
  relatedSymbols?: readonly string[] | undefined;
  /** Set together with impactSource: "provider" only when a source supplies a genuine rating. */
  estimatedImpact?: EstimatedImpact | undefined;
  impactSource?: ImpactSource | undefined;
}

export function validateNewsItem(candidate: NewsItemCandidate): NewsItem {
  if (!candidate.externalId || !candidate.externalId.trim()) {
    throw new InvalidNewsItemError("missing external id");
  }
  if (!candidate.provider || !candidate.provider.trim()) {
    throw new InvalidNewsItemError("missing provider id");
  }
  if (!NEWS_CATEGORY_SET.has(candidate.category)) {
    throw new InvalidNewsItemError(`unknown category "${candidate.category}"`);
  }
  const headline = normalizeWhitespace(candidate.headline ?? "");
  if (!headline) throw new InvalidNewsItemError("missing headline");
  if (headline.length > MAX_HEADLINE_LENGTH) {
    throw new InvalidNewsItemError(
      `headline exceeds ${MAX_HEADLINE_LENGTH} characters`,
    );
  }
  const source = normalizeWhitespace(candidate.source ?? "");
  if (!source) throw new InvalidNewsItemError("missing source/publisher");
  if (source.length > MAX_SOURCE_LENGTH) {
    throw new InvalidNewsItemError(`source exceeds ${MAX_SOURCE_LENGTH} characters`);
  }
  if (!candidate.publishedAt) {
    throw new InvalidNewsItemError("missing publication timestamp");
  }
  const publishedMs = Date.parse(candidate.publishedAt);
  if (!Number.isFinite(publishedMs)) {
    throw new InvalidNewsItemError(
      `invalid publication timestamp "${candidate.publishedAt}"`,
    );
  }
  if (!candidate.url || !isValidArticleUrl(candidate.url)) {
    throw new InvalidNewsItemError(`invalid or unsafe article url "${candidate.url}"`);
  }

  const category = candidate.category as NewsCategory;

  let relatedSymbols: readonly string[] | undefined;
  if (candidate.relatedSymbols && candidate.relatedSymbols.length > 0) {
    const cleaned = candidate.relatedSymbols
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0);
    if (cleaned.length > 0) relatedSymbols = cleaned;
  }

  // A genuine provider-supplied rating (impactSource: "provider") is never
  // overwritten by the heuristic -- see impact.ts and Part 6.
  let estimatedImpact: EstimatedImpact;
  let impactSource: ImpactSource;
  if (candidate.impactSource === "provider" && candidate.estimatedImpact) {
    estimatedImpact = candidate.estimatedImpact;
    impactSource = "provider";
  } else {
    estimatedImpact = classifyImpact({ category, headline, source, relatedSymbols });
    impactSource = "bullhaus_heuristic";
  }

  const item: NewsItem = {
    externalId: candidate.externalId.trim(),
    provider: candidate.provider,
    category,
    headline,
    source,
    publishedAt: new Date(publishedMs).toISOString(),
    url: candidate.url,
    estimatedImpact,
    impactSource,
  };
  if (candidate.summary !== undefined) {
    const summary = normalizeWhitespace(candidate.summary);
    if (summary) item.summary = summary;
  }
  if (relatedSymbols) item.relatedSymbols = relatedSymbols;
  return Object.freeze(item);
}
