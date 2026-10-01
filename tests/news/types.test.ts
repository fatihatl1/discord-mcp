import { describe, expect, it } from "vitest";
import { InvalidNewsItemError, validateNewsItem } from "../../src/news/types.js";

const BASE = {
  externalId: "ext-1",
  provider: "mock",
  category: "general",
  headline: "A Fixture Headline",
  source: "Fixture Wire",
  publishedAt: "2025-09-01T00:00:00.000Z",
  url: "https://example.com/a",
};

describe("validateNewsItem", () => {
  it("accepts a well-formed candidate and normalizes whitespace", () => {
    const item = validateNewsItem({
      ...BASE,
      headline: "  A   Fixture   Headline  ",
      source: "  Fixture   Wire  ",
    });
    expect(item.headline).toBe("A Fixture Headline");
    expect(item.source).toBe("Fixture Wire");
    expect(item.publishedAt).toBe(new Date(BASE.publishedAt).toISOString());
  });

  it("rejects an unknown category", () => {
    expect(() => validateNewsItem({ ...BASE, category: "sports" })).toThrow(
      InvalidNewsItemError,
    );
  });

  it("rejects a missing headline", () => {
    expect(() => validateNewsItem({ ...BASE, headline: "   " })).toThrow(
      InvalidNewsItemError,
    );
  });

  it("rejects a missing source/publisher", () => {
    expect(() => validateNewsItem({ ...BASE, source: "" })).toThrow(InvalidNewsItemError);
  });

  it("rejects an invalid publication timestamp", () => {
    expect(() => validateNewsItem({ ...BASE, publishedAt: "not-a-date" })).toThrow(
      InvalidNewsItemError,
    );
  });

  it("rejects a missing publication timestamp", () => {
    expect(() => validateNewsItem({ ...BASE, publishedAt: "" })).toThrow(
      InvalidNewsItemError,
    );
  });

  it("rejects an unsafe URL protocol", () => {
    expect(() =>
      validateNewsItem({ ...BASE, url: "javascript:alert(1)" }),
    ).toThrow(InvalidNewsItemError);
  });

  it("rejects a malformed URL", () => {
    expect(() => validateNewsItem({ ...BASE, url: "not a url" })).toThrow(
      InvalidNewsItemError,
    );
  });

  it("accepts an http URL as well as https", () => {
    expect(() => validateNewsItem({ ...BASE, url: "http://example.com/a" })).not.toThrow();
  });

  it("drops an empty summary but keeps a real one", () => {
    const withEmpty = validateNewsItem({ ...BASE, summary: "   " });
    expect(withEmpty.summary).toBeUndefined();
    const withReal = validateNewsItem({ ...BASE, summary: "A short summary." });
    expect(withReal.summary).toBe("A short summary.");
  });

  it("rejects a headline that is only whitespace and control characters", () => {
    expect(() => validateNewsItem({ ...BASE, headline: "\n\t  " })).toThrow(
      InvalidNewsItemError,
    );
  });

  it("returns a frozen object", () => {
    const item = validateNewsItem(BASE);
    expect(Object.isFrozen(item)).toBe(true);
  });
});
