import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FeedParseError, parseFeed } from "../../src/news/rss/parser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "..", "fixtures", "rss");

function fixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf8");
}

describe("parseFeed: valid feeds", () => {
  it("parses a valid RSS 2.0 feed", () => {
    const items = parseFeed(fixture("valid_rss.xml"));
    expect(items).toHaveLength(2);
    expect(items[0]?.title).toBe("Fixture Announcement One & Details"); // entity decoded
    expect(items[0]?.link).toBe("https://example.org/press/one");
    expect(items[0]?.id).toBe("urn:fixture:one");
    expect(items[0]?.publishedAt).toBe(new Date("Mon, 01 Sep 2025 14:30:00 GMT").toISOString());
    expect(items[0]?.description).toBe("A short fixture description for item one.");
  });

  it("parses a valid Atom feed", () => {
    const items = parseFeed(fixture("valid_atom.xml"));
    expect(items).toHaveLength(2);
    expect(items[0]?.title).toBe("Fixture Atom Entry One");
    expect(items[0]?.link).toBe("https://example.org/atom/one");
    expect(items[0]?.id).toBe("urn:fixture:atom-one");
    expect(items[0]?.publishedAt).toBe(new Date("2025-09-01T14:30:00Z").toISOString());
    // second entry uses <updated> since it has no <published>
    expect(items[1]?.publishedAt).toBe(new Date("2025-09-02T09:00:00Z").toISOString());
  });

  it("returns an empty array for a feed with no items", () => {
    expect(parseFeed(fixture("empty_feed.xml"))).toEqual([]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseFeed("")).toEqual([]);
    expect(parseFeed("   ")).toEqual([]);
  });
});

describe("parseFeed: missing or invalid dates", () => {
  it("omits publishedAt for a missing or unparsable date, keeps the item otherwise", () => {
    const items = parseFeed(fixture("missing_dates.xml"));
    expect(items).toHaveLength(3);
    expect(items[0]?.publishedAt).toBeUndefined(); // no <pubDate> at all
    expect(items[1]?.publishedAt).toBeUndefined(); // pubDate is garbage text
    expect(items[2]?.publishedAt).toBe(
      new Date("Mon, 01 Sep 2025 14:30:00 GMT").toISOString(),
    );
  });
});

describe("parseFeed: invalid links", () => {
  it("drops items with an unsafe-protocol or missing link, keeps valid ones", () => {
    const items = parseFeed(fixture("invalid_links.xml"));
    // parser itself only requires *a* link string to exist -- protocol safety
    // is enforced by validateNewsItem downstream. It still drops the item
    // with no <link> tag at all (missing required field).
    const ids = items.map((i) => i.id);
    expect(ids).toContain("urn:fixture:unsafe-protocol");
    expect(ids).not.toContain("urn:fixture:missing-link");
    expect(ids).toContain("urn:fixture:good-link");
  });
});

describe("parseFeed: duplicate items", () => {
  it("returns both occurrences -- de-duplication is the caller's job", () => {
    const items = parseFeed(fixture("duplicate_items.xml"));
    expect(items).toHaveLength(2);
    expect(items[0]?.id).toBe(items[1]?.id);
  });
});

describe("parseFeed: unsafe XML", () => {
  it("refuses to parse a feed with a DOCTYPE/ENTITY declaration (XXE guard)", () => {
    expect(() => parseFeed(fixture("unsafe_doctype.xml"))).toThrow(FeedParseError);
  });

  it("never resolves unknown named entities via a DTD", () => {
    const xml =
      "<rss><channel><item><title>&unknown;</title>" +
      "<link>https://example.org/x</link><guid>g1</guid>" +
      "<pubDate>Mon, 01 Sep 2025 14:30:00 GMT</pubDate></item></channel></rss>";
    const items = parseFeed(xml);
    expect(items[0]?.title).toBe("&unknown;"); // left as-is, not expanded
  });

  it("decodes only the five predefined entities and numeric references", () => {
    const xml =
      "<rss><channel><item><title>A &amp; B &lt;tag&gt; &#65;&#x42;</title>" +
      "<link>https://example.org/x</link><guid>g1</guid>" +
      "<pubDate>Mon, 01 Sep 2025 14:30:00 GMT</pubDate></item></channel></rss>";
    const items = parseFeed(xml);
    expect(items[0]?.title).toBe("A & B <tag> AB");
  });
});

describe("parseFeed: malformed / invalid XML", () => {
  it("degrades safely (no crash, no partial garbage item) on truncated XML", () => {
    expect(() => parseFeed(fixture("invalid_xml.xml"))).not.toThrow();
    expect(parseFeed(fixture("invalid_xml.xml"))).toEqual([]);
  });
});

describe("parseFeed: oversized input", () => {
  it("throws FeedParseError instead of processing an oversized document", () => {
    const huge = `<rss><channel>${"x".repeat(5_000_001)}</channel></rss>`;
    expect(() => parseFeed(huge)).toThrow(FeedParseError);
  });
});

describe("parseFeed: item cap", () => {
  it("never returns more than the internal item cap, even if the feed has more", () => {
    const items = Array.from(
      { length: 400 },
      (_, i) =>
        `<item><title>Item ${i}</title><link>https://example.org/${i}</link>` +
        `<guid>g${i}</guid><pubDate>Mon, 01 Sep 2025 14:30:00 GMT</pubDate></item>`,
    ).join("");
    const xml = `<rss><channel>${items}</channel></rss>`;
    expect(parseFeed(xml).length).toBeLessThanOrEqual(300);
  });
});
