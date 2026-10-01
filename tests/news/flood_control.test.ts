import { describe, expect, it } from "vitest";
import { applyFloodControl } from "../../src/news/flood_control.js";
import { validateNewsItem, type NewsItem } from "../../src/news/types.js";

const NOW = new Date("2025-09-01T12:00:00.000Z");

function itemAgeMinutes(id: string, ageMinutes: number): NewsItem {
  return validateNewsItem({
    externalId: id,
    provider: "mock",
    category: "general",
    headline: `Headline ${id}`,
    source: "Wire",
    publishedAt: new Date(NOW.getTime() - ageMinutes * 60_000).toISOString(),
    url: `https://example.com/${id}`,
  });
}

describe("applyFloodControl", () => {
  it("rejects items older than maxAgeMinutes as stale", () => {
    const items = [itemAgeMinutes("fresh", 10), itemAgeMinutes("stale", 120)];
    const result = applyFloodControl(items, {
      maxAgeMinutes: 60,
      maxPostsPerChannel: 10,
      now: () => NOW,
    });
    expect(result.eligible.map((i) => i.externalId)).toEqual(["fresh"]);
    expect(result.rejectedAsStale.map((i) => i.externalId)).toEqual(["stale"]);
  });

  it("sorts eligible items chronologically, oldest first", () => {
    const items = [itemAgeMinutes("newer", 5), itemAgeMinutes("older", 30)];
    const result = applyFloodControl(items, {
      maxAgeMinutes: 60,
      maxPostsPerChannel: 10,
      now: () => NOW,
    });
    expect(result.eligible.map((i) => i.externalId)).toEqual(["older", "newer"]);
  });

  it("caps the number of eligible items at maxPostsPerChannel", () => {
    const items = [
      itemAgeMinutes("a", 50),
      itemAgeMinutes("b", 40),
      itemAgeMinutes("c", 30),
      itemAgeMinutes("d", 20),
      itemAgeMinutes("e", 10),
    ];
    const result = applyFloodControl(items, {
      maxAgeMinutes: 60,
      maxPostsPerChannel: 3,
      now: () => NOW,
    });
    expect(result.eligible).toHaveLength(3);
    // oldest three survive the cap; the newest two are held back, not dropped silently
    expect(result.eligible.map((i) => i.externalId)).toEqual(["a", "b", "c"]);
    expect(result.rejectedByLimit.map((i) => i.externalId)).toEqual(["d", "e"]);
  });

  it("never publishes a sudden historical backlog in one run", () => {
    const backlog = Array.from({ length: 50 }, (_, i) => itemAgeMinutes(`old-${i}`, 45));
    const result = applyFloodControl(backlog, {
      maxAgeMinutes: 60,
      maxPostsPerChannel: 3,
      now: () => NOW,
    });
    expect(result.eligible).toHaveLength(3);
  });

  it("handles an empty input safely", () => {
    const result = applyFloodControl([], { maxAgeMinutes: 60, maxPostsPerChannel: 3, now: () => NOW });
    expect(result.eligible).toEqual([]);
    expect(result.rejectedAsStale).toEqual([]);
    expect(result.rejectedByLimit).toEqual([]);
  });
});
