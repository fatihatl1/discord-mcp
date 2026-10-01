import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OfficialRssProvider } from "../../src/news/providers/official_rss_provider.js";
import type { RssSourceConfig } from "../../src/news/rss/sources.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "..", "fixtures", "rss");

function fixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf8");
}

function xmlResponse(xml: string, status = 200): Response {
  return new Response(xml, { status, headers: { "content-type": "application/rss+xml" } });
}

function streamedResponse(text: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return new Response(stream);
}

function source(overrides: Partial<RssSourceConfig> = {}): RssSourceConfig {
  return {
    id: "test_source",
    institution: "Fixture Institution",
    url: "https://example.org/feed.xml",
    category: "general",
    enabled: true,
    approved: true,
    ...overrides,
  };
}

describe("OfficialRssProvider: approval gating", () => {
  it("never fetches a disabled source", async () => {
    let called = false;
    const fetchFn = (async () => {
      called = true;
      return xmlResponse(fixture("valid_rss.xml"));
    }) as typeof fetch;
    const provider = new OfficialRssProvider({
      fetchFn,
      sources: [source({ enabled: false })],
    });
    const items = await provider.fetchCategory("general");
    expect(items).toEqual([]);
    expect(called).toBe(false);
  });

  it("never fetches an unapproved source, even if enabled", async () => {
    let called = false;
    const fetchFn = (async () => {
      called = true;
      return xmlResponse(fixture("valid_rss.xml"));
    }) as typeof fetch;
    const provider = new OfficialRssProvider({
      fetchFn,
      sources: [source({ enabled: true, approved: false })],
    });
    expect(await provider.fetchCategory("general")).toEqual([]);
    expect(called).toBe(false);
  });

  it("only fetches sources matching the requested category", async () => {
    const calledUrls: string[] = [];
    const fetchFn = (async (url: string | URL) => {
      calledUrls.push(String(url));
      return xmlResponse(fixture("valid_rss.xml"));
    }) as typeof fetch;
    const provider = new OfficialRssProvider({
      fetchFn,
      sources: [
        source({ id: "gen", category: "general", url: "https://example.org/general.xml" }),
        source({ id: "fx", category: "forex", url: "https://example.org/forex.xml" }),
      ],
    });
    await provider.fetchCategory("forex");
    expect(calledUrls).toEqual(["https://example.org/forex.xml"]);
  });
});

describe("OfficialRssProvider: normalization", () => {
  it("preserves the configured institution as the publisher, not anything from the feed", async () => {
    const fetchFn = (async () => xmlResponse(fixture("valid_rss.xml"))) as typeof fetch;
    const provider = new OfficialRssProvider({
      fetchFn,
      sources: [source({ institution: "Board of Governors of the Federal Reserve System" })],
    });
    const items = await provider.fetchCategory("general");
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.source).toBe("Board of Governors of the Federal Reserve System");
      expect(item.provider).toBe("official_rss:test_source");
    }
  });

  it("drops items with a missing/invalid publication date", async () => {
    const fetchFn = (async () => xmlResponse(fixture("missing_dates.xml"))) as typeof fetch;
    const provider = new OfficialRssProvider({ fetchFn, sources: [source()] });
    const items = await provider.fetchCategory("general");
    expect(items).toHaveLength(1); // only the "good date" item survives
    expect(items[0]?.headline).toBe("Good Date Item");
  });

  it("drops items with an unsafe or malformed link via shared validation", async () => {
    const fetchFn = (async () => xmlResponse(fixture("invalid_links.xml"))) as typeof fetch;
    const provider = new OfficialRssProvider({ fetchFn, sources: [source()] });
    const items = await provider.fetchCategory("general");
    // "missing link" was already dropped by the parser; "unsafe protocol" is
    // dropped here by validateNewsItem's URL check.
    expect(items.map((i) => i.headline)).toEqual(["Good Link Item"]);
  });
});

describe("OfficialRssProvider: keyword filtering", () => {
  it("only keeps items matching a configured keyword filter", async () => {
    const fetchFn = (async () => xmlResponse(fixture("valid_rss.xml"))) as typeof fetch;
    const provider = new OfficialRssProvider({
      fetchFn,
      sources: [source({ filter: { keywords: ["Announcement Two"] } })],
    });
    const items = await provider.fetchCategory("general");
    expect(items).toHaveLength(1);
    expect(items[0]?.headline).toBe("Fixture Announcement Two");
  });

  it("keeps everything when no filter is configured", async () => {
    const fetchFn = (async () => xmlResponse(fixture("valid_rss.xml"))) as typeof fetch;
    const provider = new OfficialRssProvider({ fetchFn, sources: [source()] });
    expect(await provider.fetchCategory("general")).toHaveLength(2);
  });
});

describe("OfficialRssProvider: resilience", () => {
  it("one failing source does not block another", async () => {
    const fetchFn = (async (url: string | URL) => {
      if (String(url).includes("broken")) throw new Error("network down");
      return xmlResponse(fixture("valid_rss.xml"));
    }) as typeof fetch;
    const provider = new OfficialRssProvider({
      fetchFn,
      sources: [
        source({ id: "broken", url: "https://example.org/broken.xml" }),
        source({ id: "ok", url: "https://example.org/ok.xml" }),
      ],
    });
    const items = await provider.fetchCategory("general");
    expect(items).toHaveLength(2); // from the "ok" source only
  });

  it("treats an HTTP error status as a failed source, not a crash", async () => {
    const fetchFn = (async () => xmlResponse("", 503)) as typeof fetch;
    const provider = new OfficialRssProvider({ fetchFn, sources: [source()] });
    await expect(provider.fetchCategory("general")).resolves.toEqual([]);
  });

  it("rejects a response declaring an oversized content-length", async () => {
    const fetchFn = (async () => {
      const res = xmlResponse(fixture("valid_rss.xml"));
      Object.defineProperty(res, "headers", {
        value: new Headers({ "content-length": "999999999" }),
      });
      return res;
    }) as typeof fetch;
    const provider = new OfficialRssProvider({
      fetchFn,
      maxResponseBytes: 1000,
      sources: [source()],
    });
    await expect(provider.fetchCategory("general")).resolves.toEqual([]);
  });

  it("rejects an oversized streamed response body with no content-length header", async () => {
    const bigXml = `<rss><channel>${"x".repeat(5000)}</channel></rss>`;
    const fetchFn = (async () => streamedResponse(bigXml)) as typeof fetch;
    const provider = new OfficialRssProvider({
      fetchFn,
      maxResponseBytes: 100,
      sources: [source()],
    });
    await expect(provider.fetchCategory("general")).resolves.toEqual([]);
  });

  it("aborts and treats a timed-out source as failed, not a crash", async () => {
    const fetchFn = (async (_url: string | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
    }) as typeof fetch;
    const provider = new OfficialRssProvider({
      fetchFn,
      timeoutMs: 15,
      sources: [source()],
    });
    await expect(provider.fetchCategory("general")).resolves.toEqual([]);
  });

  it("refuses to parse a feed containing a DOCTYPE/ENTITY without crashing the provider", async () => {
    const fetchFn = (async () => xmlResponse(fixture("unsafe_doctype.xml"))) as typeof fetch;
    const provider = new OfficialRssProvider({ fetchFn, sources: [source()] });
    await expect(provider.fetchCategory("general")).resolves.toEqual([]);
  });
});
