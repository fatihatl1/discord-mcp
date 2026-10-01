import { describe, expect, it } from "vitest";
import {
  dedupeItems,
  fetchRecentlyPublishedUrls,
  normalizeArticleUrl,
} from "../../src/news/dedup.js";
import { validateNewsItem } from "../../src/news/types.js";
import type { NewsDiscordApi } from "../../src/news/discord_api.js";
import type { APIMessage, APIUser } from "../../src/discord/types.js";

const BOT_ID = "1";
const CHANNEL_ID = "500000000000000001";

function botMessage(overrides: Partial<APIMessage> = {}): APIMessage {
  return {
    id: overrides.id ?? "1",
    channel_id: CHANNEL_ID,
    author: { id: BOT_ID, username: "bot", discriminator: "0", bot: true },
    content: "",
    timestamp: new Date(0).toISOString(),
    pinned: false,
    type: 0,
    ...overrides,
  };
}

function fakeApi(messages: APIMessage[]): NewsDiscordApi {
  return {
    getCurrentUser: async (): Promise<APIUser> => ({
      id: BOT_ID,
      username: "bot",
      discriminator: "0",
      bot: true,
    }),
    listMessages: async (): Promise<APIMessage[]> => messages,
    createMessage: async (): Promise<APIMessage> => {
      throw new Error("not used in this test");
    },
  };
}

describe("normalizeArticleUrl", () => {
  it("strips fragments, lowercases the host, and drops a trailing slash", () => {
    expect(normalizeArticleUrl("https://Example.com/a/b/#frag")).toBe(
      normalizeArticleUrl("https://example.com/a/b#other"),
    );
    expect(normalizeArticleUrl("https://example.com/a/")).toBe(
      normalizeArticleUrl("https://example.com/a"),
    );
  });
});

describe("fetchRecentlyPublishedUrls", () => {
  it("extracts article links only from this bot's own, unpinned messages", async () => {
    const api = fakeApi([
      botMessage({
        id: "10",
        content: "**H1**\nWire · 00:00 UTC\n[Read article](https://example.com/a)",
      }),
      botMessage({
        id: "11",
        pinned: true,
        content: "Welcome to the news channel!", // pinned intro, must be ignored
      }),
      {
        id: "12",
        channel_id: CHANNEL_ID,
        author: { id: "999", username: "someone-else", discriminator: "0" },
        content: "[Read article](https://example.com/should-not-count)",
        timestamp: new Date(0).toISOString(),
        pinned: false,
        type: 0,
      },
    ]);
    const urls = await fetchRecentlyPublishedUrls({ api, channelId: CHANNEL_ID, botUserId: BOT_ID });
    expect(urls.has(normalizeArticleUrl("https://example.com/a"))).toBe(true);
    expect(urls.size).toBe(1);
  });
});

describe("dedupeItems", () => {
  const make = (id: string, url: string) =>
    validateNewsItem({
      externalId: id,
      provider: "mock",
      category: "general",
      headline: `Headline ${id}`,
      source: "Wire",
      publishedAt: new Date(0).toISOString(),
      url,
    });

  it("drops items whose normalized url was already published", () => {
    const already = new Set([normalizeArticleUrl("https://example.com/a")]);
    const items = [make("1", "https://example.com/a"), make("2", "https://example.com/b")];
    const result = dedupeItems(items, already);
    expect(result.map((i) => i.externalId)).toEqual(["2"]);
  });

  it("drops duplicates within the same batch, keeping the first occurrence", () => {
    const items = [
      make("1", "https://example.com/a"),
      make("2", "https://example.com/a/"), // same article, trailing slash
    ];
    const result = dedupeItems(items, new Set());
    expect(result).toHaveLength(1);
    expect(result[0]?.externalId).toBe("1");
  });
});
