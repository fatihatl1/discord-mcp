import { describe, expect, it } from "vitest";
import { formatNewsMessage, formatZurichTime } from "../../src/news/format.js";
import { validateNewsItem, type NewsItem } from "../../src/news/types.js";

const BASE = {
  externalId: "1",
  provider: "mock",
  category: "general" as const,
  headline: "Fixture Headline",
  source: "Fixture Wire",
  publishedAt: "2025-09-01T14:05:00.000Z",
  url: "https://example.com/article",
};

describe("formatNewsMessage", () => {
  it("renders headline / publisher · time / estimated impact / link on four lines", () => {
    const item = validateNewsItem(BASE);
    const message = formatNewsMessage(item);
    const lines = message.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe("**Fixture Headline**");
    expect(lines[1]).toBe("Fixture Wire · 16:05 CEST"); // 2025-09-01T14:05:00Z is CEST (UTC+2) in Zurich
    expect(lines[2]).toBe("Estimated Impact: Low");
    expect(lines[3]).toBe("[Read article](https://example.com/article)");
  });

  it("renders the exact Medium/High labels, never 'Middle', stars, or emoji", () => {
    const medium = validateNewsItem({ ...BASE, headline: "Major Acquisition Announced" });
    expect(medium.estimatedImpact).toBe("medium");
    expect(formatNewsMessage(medium)).toContain("Estimated Impact: Medium");

    const high = validateNewsItem({ ...BASE, headline: "Federal Reserve FOMC Decision Due" });
    expect(high.estimatedImpact).toBe("high");
    const message = formatNewsMessage(high);
    expect(message).toContain("Estimated Impact: High");
    expect(message).not.toContain("Middle");
    expect(message).not.toMatch(/[⭐★☆]/); // star glyphs
    expect(message).not.toMatch(/\p{Extended_Pictographic}/u); // emoji
  });

  it("never implies the estimate came from Finnhub", () => {
    const item = validateNewsItem({ ...BASE, provider: "finnhub" });
    const message = formatNewsMessage(item);
    expect(message.toLowerCase()).not.toContain("finnhub");
  });

  it("never includes an emoji, image markdown, or summary text", () => {
    const item = validateNewsItem({ ...BASE, summary: "Should never appear." });
    const message = formatNewsMessage(item);
    expect(message).not.toContain("Should never appear");
    expect(message).not.toMatch(/!\[.*\]\(.*\)/); // markdown image syntax
  });

  it("escapes Discord markdown control characters in the headline and publisher", () => {
    const item = validateNewsItem({
      ...BASE,
      headline: "Rates *up* _now_ ~maybe~ `code`",
      source: "Wire | Extra",
    });
    const message = formatNewsMessage(item);
    expect(message).toContain("Rates \\*up\\* \\_now\\_ \\~maybe\\~ \\`code\\`");
    expect(message).toContain("Wire \\| Extra");
  });

  it("neutralizes @everyone/@here and role/user mentions", () => {
    const item = validateNewsItem({
      ...BASE,
      headline: "@everyone @here <@123456789012345678> <@&123456789012345678> update",
    });
    const message = formatNewsMessage(item);
    expect(message).not.toContain("@everyone");
    expect(message).not.toContain("@here");
    expect(message).toContain("@​everyone");
    expect(message).toContain("<@​123456789012345678>");
  });

  it("formats the timestamp as Europe/Zurich local time regardless of local system time, crossing midnight into the next calendar day", () => {
    // 2025-12-31T23:59:00Z is winter (CET, UTC+1) -> 2026-01-01T00:59 local.
    const item = validateNewsItem({ ...BASE, publishedAt: "2025-12-31T23:59:00.000Z" });
    expect(formatNewsMessage(item)).toContain("00:59 CET");
  });

  it("respects Discord's 2000-character message limit even for an oversized headline", () => {
    // validateNewsItem already caps headlines at 512 chars, so a message can
    // never actually reach 2000 in practice -- this exercises the format
    // function's own safety net directly, bypassing that upstream cap.
    const item: NewsItem = {
      externalId: "x",
      provider: "mock",
      category: "general",
      headline: "A".repeat(3000),
      source: "Fixture Wire",
      publishedAt: BASE.publishedAt,
      url: BASE.url,
      estimatedImpact: "low",
      impactSource: "bullhaus_heuristic",
    };
    const message = formatNewsMessage(item);
    expect(message.length).toBeLessThanOrEqual(2000);
    expect(message).toContain("[Read article](https://example.com/article)");
  });

  it("normalizes internal whitespace/newlines in the headline", () => {
    const item = validateNewsItem({ ...BASE, headline: "Line one\nLine   two" });
    expect(formatNewsMessage(item)).toContain("Line one Line two");
  });
});

// Phase 3H.5, Part 4: Europe/Zurich timezone formatting. The abbreviation is
// derived from the actual UTC+01:00/UTC+02:00 offset at the given instant,
// never from a fixed calendar assumption -- the DST transition dates move
// every year and must come from the timezone database, not from "March is
// summer"-style guesses.
describe("formatZurichTime: Europe/Zurich conversion", () => {
  it("converts a summer (CEST, UTC+2) instant", () => {
    expect(formatZurichTime("2026-09-30T20:57:32.000Z")).toBe("22:57 CEST");
  });

  it("converts a winter (CET, UTC+1) instant", () => {
    expect(formatZurichTime("2026-01-15T12:00:00.000Z")).toBe("13:00 CET");
  });

  it("converts another summer Central European date", () => {
    expect(formatZurichTime("2026-07-15T18:30:00.000Z")).toBe("20:30 CEST");
  });

  it("remains correct when the Zurich local date differs from the UTC date", () => {
    // 2026-07-15T22:15:00Z is still CEST (UTC+2): local time rolls over into
    // 2026-07-16 even though the UTC instant is still on 2026-07-15.
    expect(formatZurichTime("2026-07-15T22:15:00.000Z")).toBe("00:15 CEST");
    // 2026-01-01T23:30:00Z is CET (UTC+1): local time stays on 2026-01-02
    // just after midnight.
    expect(formatZurichTime("2026-01-01T23:30:00.000Z")).toBe("00:30 CET");
  });

  it("never displays UTC, MEZ, MESZ, or a fixed GMT offset", () => {
    const label = formatZurichTime("2026-09-30T20:57:32.000Z");
    expect(label).not.toContain("UTC");
    expect(label).not.toContain("MEZ");
    expect(label).not.toContain("MESZ");
    expect(label).not.toMatch(/GMT/);
  });

  it("derives DST from the timezone database, not a fixed month assumption", () => {
    // 2026-03-28 is before that year's spring-forward (2026-03-29) -- still CET.
    expect(formatZurichTime("2026-03-28T10:00:00.000Z")).toBe("11:00 CET");
    // 2026-10-25 is that year's fall-back day itself (clocks go back at
    // 01:00 UTC) -- by 10:00 UTC the same day, Zurich is already back to CET.
    expect(formatZurichTime("2026-10-25T10:00:00.000Z")).toBe("11:00 CET");
  });
});
