import { describe, expect, it } from "vitest";
import { NEWS_CHANNELS } from "../../src/config/bullhaus.js";
import type { APIMessage, APIUser } from "../../src/discord/types.js";
import { MESSAGE_FLAGS } from "../../src/discord/types.js";
import type { NewsConfig } from "../../src/news/config.js";
import type { NewsDiscordApi } from "../../src/news/discord_api.js";
import type { NewsProvider } from "../../src/news/provider.js";
import { publishCategory, runNewsWorker } from "../../src/news/publisher.js";
import { validateNewsItem, type NewsCategory, type NewsItem } from "../../src/news/types.js";

const BOT_ID = "1";

class FakeNewsApi implements NewsDiscordApi {
  messagesByChannel = new Map<string, APIMessage[]>();
  createCalls: Array<{ channelId: string; content: string; flags?: number }> = [];
  listMessagesError: Error | undefined;
  private nextId = 1000;

  async getCurrentUser(): Promise<APIUser> {
    return { id: BOT_ID, username: "bullhaus-bot", discriminator: "0", bot: true };
  }

  async listMessages(channelId: string): Promise<APIMessage[]> {
    if (this.listMessagesError) throw this.listMessagesError;
    return this.messagesByChannel.get(channelId) ?? [];
  }

  async createMessage(
    channelId: string,
    payload: { content: string; flags?: number },
  ): Promise<APIMessage> {
    this.createCalls.push({ channelId, content: payload.content, flags: payload.flags });
    const message: APIMessage = {
      id: String(this.nextId++),
      channel_id: channelId,
      author: { id: BOT_ID, username: "bullhaus-bot", discriminator: "0", bot: true },
      content: payload.content,
      timestamp: new Date().toISOString(),
      pinned: false,
      type: 0,
      ...(payload.flags !== undefined ? { flags: payload.flags } : {}),
    };
    const list = this.messagesByChannel.get(channelId) ?? [];
    list.push(message);
    this.messagesByChannel.set(channelId, list);
    return message;
  }

  seedPublished(channelId: string, url: string): void {
    const list = this.messagesByChannel.get(channelId) ?? [];
    list.push({
      id: String(this.nextId++),
      channel_id: channelId,
      author: { id: BOT_ID, username: "bullhaus-bot", discriminator: "0", bot: true },
      content: `**Old**\nWire · 00:00 UTC\n[Read article](${url})`,
      timestamp: new Date(0).toISOString(),
      pinned: false,
      type: 0,
    });
    this.messagesByChannel.set(channelId, list);
  }
}

class FakeProvider implements NewsProvider {
  constructor(
    readonly id: string,
    private readonly itemsByCategory: Partial<Record<NewsCategory, NewsItem[]>> = {},
    private readonly throwFor?: NewsCategory,
  ) {}

  async fetchCategory(category: NewsCategory): Promise<NewsItem[]> {
    if (this.throwFor === category) throw new Error("simulated provider failure");
    return this.itemsByCategory[category] ?? [];
  }
}

function item(overrides: Partial<Parameters<typeof validateNewsItem>[0]>): NewsItem {
  return validateNewsItem({
    externalId: "1",
    provider: "official_rss:test",
    category: "general",
    headline: "Headline",
    source: "Wire",
    publishedAt: new Date().toISOString(),
    url: "https://example.com/1",
    ...overrides,
  });
}

function baseConfig(overrides: Partial<NewsConfig> = {}): NewsConfig {
  return {
    dryRun: false,
    publishEnabled: true,
    finnhubLicenseApproved: false,
    maxAgeMinutes: 60,
    maxPostsPerChannel: 3,
    historyLookback: 100,
    providers: ["mock"],
    ...overrides,
  };
}

describe("publishCategory: routing", () => {
  it("publishes general/forex/crypto items to their respective configured channels", async () => {
    for (const category of ["general", "forex", "crypto"] as const) {
      const api = new FakeNewsApi();
      const provider = new FakeProvider("official_rss:test", {
        [category]: [item({ category, url: `https://example.com/${category}` })],
      });
      const result = await publishCategory(category, {
        api,
        providers: [provider],
        config: baseConfig(),
      });
      expect(result.channelId).toBe(NEWS_CHANNELS[category]);
      expect(result.published).toHaveLength(1);
      expect(api.createCalls).toHaveLength(1);
      expect(api.createCalls[0]?.channelId).toBe(NEWS_CHANNELS[category]);
    }
  });

  it("always sends with the SUPPRESS_EMBEDS flag", async () => {
    const api = new FakeNewsApi();
    const provider = new FakeProvider("official_rss:test", {
      general: [item({ category: "general" })],
    });
    await publishCategory("general", { api, providers: [provider], config: baseConfig() });
    expect(api.createCalls[0]?.flags).toBe(MESSAGE_FLAGS.SUPPRESS_EMBEDS);
  });
});

describe("publishCategory: duplicate prevention", () => {
  it("does not republish an article already posted in that channel's recent history", async () => {
    const api = new FakeNewsApi();
    api.seedPublished(NEWS_CHANNELS.general, "https://example.com/already-posted");
    const provider = new FakeProvider("official_rss:test", {
      general: [item({ url: "https://example.com/already-posted" })],
    });
    const result = await publishCategory("general", {
      api,
      providers: [provider],
      config: baseConfig(),
    });
    expect(result.published).toHaveLength(0);
    expect(api.createCalls).toHaveLength(0);
  });

  it("skips publication for the channel entirely when the duplicate check fails", async () => {
    const api = new FakeNewsApi();
    api.listMessagesError = new Error("discord unavailable");
    const provider = new FakeProvider("official_rss:test", {
      general: [item({})],
    });
    const result = await publishCategory("general", {
      api,
      providers: [provider],
      config: baseConfig(),
    });
    expect(result.duplicateCheckFailed).toBe(true);
    expect(result.published).toHaveLength(0);
    expect(api.createCalls).toHaveLength(0);
    expect(result.skipped[0]?.reason).toBe("duplicate_check_failed");
  });
});

describe("publishCategory: flood control integration", () => {
  it("drops stale items and caps volume per channel", async () => {
    const now = new Date("2025-01-01T00:00:00.000Z");
    const items = [
      item({ externalId: "stale", publishedAt: new Date(now.getTime() - 5 * 3600_000).toISOString(), url: "https://example.com/stale" }),
      item({ externalId: "a", publishedAt: new Date(now.getTime() - 50 * 60_000).toISOString(), url: "https://example.com/a" }),
      item({ externalId: "b", publishedAt: new Date(now.getTime() - 40 * 60_000).toISOString(), url: "https://example.com/b" }),
      item({ externalId: "c", publishedAt: new Date(now.getTime() - 30 * 60_000).toISOString(), url: "https://example.com/c" }),
      item({ externalId: "d", publishedAt: new Date(now.getTime() - 20 * 60_000).toISOString(), url: "https://example.com/d" }),
    ];
    const api = new FakeNewsApi();
    const provider = new FakeProvider("official_rss:test", { general: items });
    const result = await publishCategory("general", {
      api,
      providers: [provider],
      config: baseConfig({ maxAgeMinutes: 60, maxPostsPerChannel: 3 }),
      now: () => now,
    });
    expect(result.rejectedAsStaleCount).toBe(1);
    expect(result.published).toHaveLength(3);
    expect(result.published.map((i) => i.externalId)).toEqual(["a", "b", "c"]);
  });
});

describe("publishCategory: provider errors", () => {
  it("records a provider failure without crashing and without blocking other providers", async () => {
    const api = new FakeNewsApi();
    const okProvider = new FakeProvider("official_rss:ok", {
      general: [item({ externalId: "ok-1", url: "https://example.com/ok-1" })],
    });
    const badProvider = new FakeProvider("official_rss:bad", {}, "general");
    const result = await publishCategory("general", {
      api,
      providers: [okProvider, badProvider],
      config: baseConfig(),
    });
    expect(result.providerErrors).toHaveLength(1);
    expect(result.providerErrors[0]).toContain("official_rss:bad");
    expect(result.published).toHaveLength(1);
  });
});

describe("publishCategory: licensing / approval gates", () => {
  it("never sends a mock-provider item live, even with publishing fully enabled", async () => {
    const api = new FakeNewsApi();
    const provider = new FakeProvider("mock", { general: [item({ provider: "mock" })] });
    const result = await publishCategory("general", {
      api,
      providers: [provider],
      config: baseConfig({ dryRun: false, publishEnabled: true }),
    });
    expect(result.published).toHaveLength(0);
    expect(api.createCalls).toHaveLength(0);
    expect(result.skipped[0]?.reason).toBe("mock_provider_never_publishes_live");
  });

  it("blocks finnhub items until the finnhub license flag is approved", async () => {
    const api = new FakeNewsApi();
    const provider = new FakeProvider("finnhub", { general: [item({ provider: "finnhub" })] });
    const notApproved = await publishCategory("general", {
      api,
      providers: [provider],
      config: baseConfig({ finnhubLicenseApproved: false }),
    });
    expect(notApproved.published).toHaveLength(0);
    expect(notApproved.skipped[0]?.reason).toBe("finnhub_license_not_approved");

    const api2 = new FakeNewsApi();
    const approved = await publishCategory("general", {
      api: api2,
      providers: [provider],
      config: baseConfig({ finnhubLicenseApproved: true }),
    });
    expect(approved.published).toHaveLength(1);
  });

  it("blocks every publish while dry-run is active, regardless of approvals", async () => {
    const api = new FakeNewsApi();
    const provider = new FakeProvider("finnhub", { general: [item({ provider: "finnhub" })] });
    const result = await publishCategory("general", {
      api,
      providers: [provider],
      config: baseConfig({ dryRun: true, finnhubLicenseApproved: true }),
    });
    expect(result.published).toHaveLength(0);
    expect(api.createCalls).toHaveLength(0);
    expect(result.skipped[0]?.reason).toBe("dry_run");
    expect(result.skipped[0]?.preview).toContain("[Read article]");
  });
});

describe("runNewsWorker", () => {
  it("processes general/forex/crypto independently -- one category's failure doesn't stop the others", async () => {
    const api = new FakeNewsApi();
    const provider = new FakeProvider(
      "official_rss:test",
      {
        general: [item({ category: "general", url: "https://example.com/g" })],
        forex: [item({ category: "forex", url: "https://example.com/f" })],
      },
      "crypto", // throws for crypto only
    );
    const results = await runNewsWorker({ api, providers: [provider], config: baseConfig() });
    expect(results.map((r) => r.category)).toEqual(["general", "forex", "crypto"]);
    expect(results[0]?.published).toHaveLength(1);
    expect(results[1]?.published).toHaveLength(1);
    expect(results[2]?.providerErrors).toHaveLength(1);
    expect(results[2]?.published).toHaveLength(0);
  });
});

describe("publishCategory: missing credentials", () => {
  it("treats a credential-less provider (returns no items) as simply empty, not an error", async () => {
    const api = new FakeNewsApi();
    const provider = new FakeProvider("finnhub", {}); // simulates FinnhubProvider with no API key
    const result = await publishCategory("general", {
      api,
      providers: [provider],
      config: baseConfig(),
    });
    expect(result.fetchedCount).toBe(0);
    expect(result.providerErrors).toHaveLength(0);
    expect(result.published).toHaveLength(0);
  });
});
