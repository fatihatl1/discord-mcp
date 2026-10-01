import type { NewsCategory } from "../config/bullhaus.js";
import type { NewsItem } from "./types.js";

/**
 * Shared abstraction every news source implements. The worker never talks to
 * Mock/Finnhub/RSS-specific code directly -- only to this interface -- so
 * adding a fourth provider later never touches worker/formatting/dedup code.
 */
export interface NewsProvider {
  /** Stable id used for logging and as the NewsItem.provider prefix. */
  readonly id: string;
  /**
   * Fetch and normalize items for one category. Implementations must never
   * throw for a single bad upstream item or a single failed source -- drop
   * it and keep going, so one bad item/source never blocks the rest of the
   * category. Throwing is reserved for a fully failed fetch (network down,
   * missing config), and even then the worker treats that category's items
   * as empty rather than aborting other categories.
   */
  fetchCategory(category: NewsCategory): Promise<NewsItem[]>;
}
