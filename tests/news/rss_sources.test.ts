import { describe, expect, it } from "vitest";
import { enabledApprovedSources, RSS_SOURCES } from "../../src/news/rss/sources.js";

describe("RSS_SOURCES", () => {
  it("every configured url is https-only", () => {
    for (const source of RSS_SOURCES) {
      expect(source.url.startsWith("https://")).toBe(true);
    }
  });

  it("every new source defaults to disabled and unapproved", () => {
    for (const source of RSS_SOURCES) {
      expect(source.enabled).toBe(false);
      expect(source.approved).toBe(false);
    }
  });

  it("has no configured source for crypto (no verified official feed identified)", () => {
    expect(RSS_SOURCES.some((s) => s.category === "crypto")).toBe(false);
  });

  it("every source has a non-empty institution and a unique id", () => {
    const ids = new Set<string>();
    for (const source of RSS_SOURCES) {
      expect(source.institution.trim().length).toBeGreaterThan(0);
      expect(ids.has(source.id)).toBe(false);
      ids.add(source.id);
    }
  });
});

describe("enabledApprovedSources", () => {
  it("returns nothing while every source is unreviewed (the shipped default)", () => {
    expect(enabledApprovedSources("general")).toEqual([]);
    expect(enabledApprovedSources("forex")).toEqual([]);
    expect(enabledApprovedSources("crypto")).toEqual([]);
  });
});
