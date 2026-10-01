/**
 * Local, credential-free provider for tests, dry runs, and message-format /
 * routing / dedup / flood-control validation. Every fixture is clearly and
 * deliberately fictional -- fake publishers, example.com links -- so it can
 * never be mistaken for real financial news.
 */

import type { NewsCategory } from "../../config/bullhaus.js";
import type { NewsProvider } from "../provider.js";
import { validateNewsItem, type NewsItem } from "../types.js";

export interface MockProviderOptions {
  /** Injectable clock so fixture ages are deterministic in tests. */
  now?: () => Date;
}

interface Fixture {
  externalId: string;
  headline: string;
  source: string;
  url: string;
  summary?: string;
  /** Minutes before "now" this fixture is dated -- lets tests exercise age filtering. */
  ageMinutes: number;
}

const FIXTURES: Record<NewsCategory, Fixture[]> = {
  general: [
    {
      externalId: "mock-general-1",
      headline: "[FICTIONAL] Central Bank Holds Benchmark Rate Steady",
      source: "Bullhaus Test Wire",
      url: "https://example.com/news/mock-general-1",
      summary: "Illustrative fixture for local testing only -- not real news.",
      ageMinutes: 5,
    },
    {
      externalId: "mock-general-2",
      headline: "[FICTIONAL] Composite Market Index Ticks Up In Quiet Trading",
      source: "Fictional Markets Daily",
      url: "https://example.com/news/mock-general-2",
      ageMinutes: 40,
    },
    {
      externalId: "mock-general-3",
      headline: "[FICTIONAL] Quarterly Outlook Report Released By Test Institute",
      source: "Bullhaus Test Wire",
      url: "https://example.com/news/mock-general-3",
      ageMinutes: 180,
    },
  ],
  forex: [
    {
      externalId: "mock-forex-1",
      headline: "[FICTIONAL] Dollar Index Little Changed Ahead Of Test Data",
      source: "Bullhaus Test Wire",
      url: "https://example.com/news/mock-forex-1",
      ageMinutes: 10,
    },
    {
      externalId: "mock-forex-2",
      headline: "[FICTIONAL] Euro Edges Higher Against Fictional Yen Cross",
      source: "Fictional Markets Daily",
      url: "https://example.com/news/mock-forex-2",
      ageMinutes: 90,
    },
  ],
  crypto: [
    {
      externalId: "mock-crypto-1",
      headline: "[FICTIONAL] Test Token ABC Rises On Fictional Exchange Volume",
      source: "Bullhaus Test Wire",
      url: "https://example.com/news/mock-crypto-1",
      ageMinutes: 15,
    },
    {
      externalId: "mock-crypto-2",
      headline: "[FICTIONAL] Example Protocol Announces Fictional Network Upgrade",
      source: "Fictional Markets Daily",
      url: "https://example.com/news/mock-crypto-2",
      ageMinutes: 120,
    },
  ],
};

export class MockNewsProvider implements NewsProvider {
  readonly id = "mock";
  private readonly now: () => Date;

  constructor(opts: MockProviderOptions = {}) {
    this.now = opts.now ?? (() => new Date());
  }

  async fetchCategory(category: NewsCategory): Promise<NewsItem[]> {
    const fixtures = FIXTURES[category] ?? [];
    const nowMs = this.now().getTime();
    return fixtures.map((f) =>
      validateNewsItem({
        externalId: f.externalId,
        provider: this.id,
        category,
        headline: f.headline,
        source: f.source,
        url: f.url,
        summary: f.summary,
        publishedAt: new Date(nowMs - f.ageMinutes * 60_000).toISOString(),
      }),
    );
  }
}
