/**
 * Central, Owner-editable RSS source list -- the only place a feed URL is
 * written down. Every url below was verified live against the issuing
 * institution's own site (never invented, never an unofficial mirror):
 *
 * - Fed feeds: enumerated from https://www.federalreserve.gov/feeds/feeds.htm
 * - ECB feed: enumerated from https://www.ecb.europa.eu/home/html/rss.en.html
 *   (ecb_press's url ends in .html but its content-type/body is a genuine
 *   RSS 2.0 document -- verified directly, not assumed from the extension).
 *
 * New sources MUST default to enabled: false, approved: false until the
 * Owner reviews them -- see README "News Worker" section for the approval
 * workflow and each source's redistribution/licensing caveats.
 */

import type { NewsCategory } from "../../config/bullhaus.js";

export interface RssSourceFilter {
  /** Case-insensitive substrings; an item needs at least one match to pass. */
  keywords?: readonly string[];
}

export interface RssSourceConfig {
  id: string;
  institution: string;
  url: string;
  category: NewsCategory;
  enabled: boolean;
  /** Explicit per-source publication approval, independent of provider-level gates. */
  approved: boolean;
  filter?: RssSourceFilter;
}

function httpsUrl(id: string, url: string): string {
  if (!url.startsWith("https://")) {
    throw new Error(`RSS source "${id}": url must be an https:// endpoint, got "${url}"`);
  }
  return url;
}

export const RSS_SOURCES: readonly RssSourceConfig[] = [
  {
    id: "fed_press_all",
    institution: "Board of Governors of the Federal Reserve System",
    url: httpsUrl("fed_press_all", "https://www.federalreserve.gov/feeds/press_all.xml"),
    category: "general",
    enabled: false,
    approved: false,
  },
  {
    id: "fed_press_monetary",
    institution: "Board of Governors of the Federal Reserve System",
    url: httpsUrl(
      "fed_press_monetary",
      "https://www.federalreserve.gov/feeds/press_monetary.xml",
    ),
    category: "forex",
    enabled: false,
    approved: false,
    // Not every monetary-policy-tagged Fed release is forex-moving; restrict
    // to items that plausibly are, per Part 16's "do not automatically
    // classify every publication ... as important forex news".
    filter: {
      keywords: ["FOMC", "federal funds rate", "monetary policy", "interest rate"],
    },
  },
  {
    id: "ecb_press",
    institution: "European Central Bank",
    url: httpsUrl("ecb_press", "https://www.ecb.europa.eu/rss/press.html"),
    category: "general",
    enabled: false,
    approved: false,
  },
  // Crypto: intentionally no official RSS source configured here. No
  // verified, appropriately licensed official crypto-regulator feed has been
  // identified yet -- do not add one speculatively. The Mock Provider still
  // exercises Crypto News formatting/routing/dedup/flood-control in tests.
] as const;

export function enabledApprovedSources(category: NewsCategory): RssSourceConfig[] {
  return RSS_SOURCES.filter(
    (s) => s.category === category && s.enabled && s.approved,
  );
}
