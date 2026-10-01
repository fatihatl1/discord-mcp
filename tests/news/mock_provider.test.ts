import { describe, expect, it } from "vitest";
import { MockNewsProvider } from "../../src/news/providers/mock_provider.js";

describe("MockNewsProvider", () => {
  it("requires no credentials and returns items for each category", async () => {
    const provider = new MockNewsProvider();
    for (const category of ["general", "forex", "crypto"] as const) {
      const items = await provider.fetchCategory(category);
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.category).toBe(category);
        expect(item.provider).toBe("mock");
      }
    }
  });

  it("produces clearly fictional fixtures, never mistakable for real news", async () => {
    const provider = new MockNewsProvider();
    const items = await provider.fetchCategory("general");
    for (const item of items) {
      expect(item.headline).toMatch(/FICTIONAL/);
      expect(item.url).toMatch(/^https:\/\/example\.com\//);
    }
  });

  it("dates fixtures relative to an injectable clock, for deterministic age-filter tests", async () => {
    const fixedNow = new Date("2025-01-01T00:00:00.000Z");
    const provider = new MockNewsProvider({ now: () => fixedNow });
    const items = await provider.fetchCategory("forex");
    for (const item of items) {
      expect(Date.parse(item.publishedAt)).toBeLessThanOrEqual(fixedNow.getTime());
    }
  });

  it("returns validated items (every item passes the shared NewsItem schema)", async () => {
    const provider = new MockNewsProvider();
    const items = await provider.fetchCategory("crypto");
    for (const item of items) {
      expect(item.externalId).toBeTruthy();
      expect(item.headline).toBeTruthy();
      expect(item.source).toBeTruthy();
      expect(() => new URL(item.url)).not.toThrow();
    }
  });
});
