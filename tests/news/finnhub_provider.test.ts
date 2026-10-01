import { describe, expect, it } from "vitest";
import { FinnhubProvider } from "../../src/news/providers/finnhub_provider.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const SAMPLE_ITEM = {
  id: 12345,
  headline: "Fixture Finnhub Headline",
  source: "Fixture Wire",
  url: "https://example.com/finnhub/1",
  datetime: 1_700_000_000, // seconds
  summary: "A short teaser.",
};

describe("FinnhubProvider: credentials", () => {
  it("returns no items and never calls fetch when FINNHUB_API_KEY is missing", async () => {
    let called = false;
    const fetchFn = (async () => {
      called = true;
      return jsonResponse(200, []);
    }) as typeof fetch;
    const provider = new FinnhubProvider({ apiKey: undefined, fetchFn });
    const items = await provider.fetchCategory("general");
    expect(items).toEqual([]);
    expect(called).toBe(false);
  });
});

describe("FinnhubProvider: happy path", () => {
  it("normalizes a valid response into NewsItems", async () => {
    let requestedUrl = "";
    const fetchFn = (async (url: string | URL) => {
      requestedUrl = String(url);
      return jsonResponse(200, [SAMPLE_ITEM]);
    }) as typeof fetch;
    const provider = new FinnhubProvider({ apiKey: "test-key", fetchFn });

    const items = await provider.fetchCategory("forex");
    expect(items).toHaveLength(1);
    expect(items[0]?.externalId).toBe("finnhub-12345");
    expect(items[0]?.provider).toBe("finnhub");
    expect(items[0]?.category).toBe("forex");
    expect(items[0]?.headline).toBe("Fixture Finnhub Headline");
    expect(items[0]?.source).toBe("Fixture Wire");
    expect(items[0]?.publishedAt).toBe(new Date(1_700_000_000 * 1000).toISOString());
    expect(requestedUrl).toContain("category=forex");
    expect(requestedUrl).toContain("token=test-key");
  });

  it("de-duplicates items sharing the same id within one response", async () => {
    const fetchFn = (async () => jsonResponse(200, [SAMPLE_ITEM, SAMPLE_ITEM])) as typeof fetch;
    const provider = new FinnhubProvider({ apiKey: "test-key", fetchFn });
    const items = await provider.fetchCategory("general");
    expect(items).toHaveLength(1);
  });

  it("drops individual malformed entries but keeps the valid ones", async () => {
    const fetchFn = (async () =>
      jsonResponse(200, [
        SAMPLE_ITEM,
        { id: 2, headline: "Missing url/source/datetime" },
        { id: 3, headline: "Bad url", source: "X", url: "javascript:x", datetime: 1 },
      ])) as typeof fetch;
    const provider = new FinnhubProvider({ apiKey: "test-key", fetchFn });
    const items = await provider.fetchCategory("crypto");
    expect(items).toHaveLength(1);
    expect(items[0]?.externalId).toBe("finnhub-12345");
  });
});

describe("FinnhubProvider: error handling", () => {
  it("returns no items on an HTTP error status", async () => {
    const fetchFn = (async () => new Response("boom", { status: 500 })) as typeof fetch;
    const provider = new FinnhubProvider({ apiKey: "k", fetchFn });
    expect(await provider.fetchCategory("general")).toEqual([]);
  });

  it("returns no items when rate limited (429)", async () => {
    const fetchFn = (async () => new Response("", { status: 429 })) as typeof fetch;
    const provider = new FinnhubProvider({ apiKey: "k", fetchFn });
    expect(await provider.fetchCategory("general")).toEqual([]);
  });

  it("returns no items on invalid JSON", async () => {
    const fetchFn = (async () => new Response("not json", { status: 200 })) as typeof fetch;
    const provider = new FinnhubProvider({ apiKey: "k", fetchFn });
    expect(await provider.fetchCategory("general")).toEqual([]);
  });

  it("returns no items when the response is not an array", async () => {
    const fetchFn = (async () => jsonResponse(200, { unexpected: true })) as typeof fetch;
    const provider = new FinnhubProvider({ apiKey: "k", fetchFn });
    expect(await provider.fetchCategory("general")).toEqual([]);
  });

  it("returns no items on a network error", async () => {
    const fetchFn = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const provider = new FinnhubProvider({ apiKey: "k", fetchFn });
    expect(await provider.fetchCategory("general")).toEqual([]);
  });

  it("aborts and returns no items on a request timeout", async () => {
    const fetchFn = (async (_url: string | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
    }) as typeof fetch;
    const provider = new FinnhubProvider({ apiKey: "k", fetchFn, timeoutMs: 15 });
    expect(await provider.fetchCategory("general")).toEqual([]);
  });
});
