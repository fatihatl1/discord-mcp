import { describe, expect, it } from "vitest";
import { classifyImpact } from "../../src/news/impact.js";
import { validateNewsItem } from "../../src/news/types.js";

describe("classifyImpact: High", () => {
  const cases: Array<[string, "general" | "forex" | "crypto"]> = [
    ["Federal Reserve Holds Emergency Meeting Ahead Of Interest-Rate Decision", "general"],
    ["US CPI Inflation Report Shows Higher Than Expected Price Growth", "general"],
    ["Nonfarm Payrolls Report Surprises Markets, Jobs Data Beats Estimates", "general"],
    ["ECB Rate Decision Sends Euro Sharply Higher Against The Dollar", "forex"],
    ["Bank Of Japan Rate Decision Due Amid Yen Volatility", "forex"],
    ["SNB Rate Decision Due As Franc Strength Persists", "forex"],
    ["Federal Reserve Rate Decision Due Later Today", "general"],
    ["Emergency Central Bank Intervention Announced To Stem Market Rout", "general"],
    ["Emergency Government Financial Intervention Unveiled To Stabilize Banks", "general"],
    ["Major Bitcoin ETF Approval Expected This Week, Sources Say", "crypto"],
    ["SEC Crypto Enforcement Action Rattles Exchanges Sector-Wide", "crypto"],
    ["Major Exchange Hack Prompts Sector-Wide Sell-Off", "crypto"],
  ];

  for (const [headline, category] of cases) {
    it(`classifies "${headline}" as high`, () => {
      expect(classifyImpact({ category, headline })).toBe("high");
    });
  }

  it("is case-insensitive", () => {
    expect(
      classifyImpact({ category: "general", headline: "federal reserve fomc statement due" }),
    ).toBe("high");
    expect(
      classifyImpact({ category: "general", headline: "FEDERAL RESERVE FOMC STATEMENT DUE" }),
    ).toBe("high");
  });

  it("uses related symbols to confirm an unnamed crypto ETF decision", () => {
    expect(
      classifyImpact({
        category: "crypto",
        headline: "ETF Decision Expected This Week From Regulator",
        relatedSymbols: ["BTC"],
      }),
    ).toBe("high");
    // Without a coin name in the headline AND no related symbol, this is not confirmed as high.
    expect(
      classifyImpact({ category: "crypto", headline: "ETF Decision Expected This Week" }),
    ).not.toBe("high");
  });

  it("does not demote a genuine policy decision or emergency event out of High merely for recap/wrap wording (Part 3)", () => {
    expect(
      classifyImpact({
        category: "general",
        headline: "FOMC Recap: Fed Holds Rates Steady Amid Inflation Concerns",
      }),
    ).toBe("high");
    expect(
      classifyImpact({
        category: "general",
        headline: "Market Wrap: Banking Crisis Deepens As Contagion Spreads",
      }),
    ).toBe("high");
  });
});

describe("classifyImpact: Medium", () => {
  const cases: Array<[string, "general" | "forex" | "crypto"]> = [
    ["Fed Chair Comments On Economic Outlook Without Policy Change", "general"],
    ["Major Acquisition Announced Between Two Industrial Giants", "general"],
    ["Analyst Upgrades Outlook For Dollar Amid Fed Policy Bets", "forex"],
    ["Retail Sales Data Released For Major Economy", "forex"],
    ["Cryptocurrency Regulatory Developments Expected From Lawmakers", "crypto"],
    ["Institutional Crypto ETF Inflows Hit New Weekly High", "crypto"],
    // Part 6 refinement: Fed Chair leadership changes and central-bank
    // independence disputes, without any rate-decision keyword present.
    ["Fed Chair Announces Resignation Amid Political Pressure", "general"],
    ["Senate Debates Bill To Remove Federal Reserve Chair", "general"],
    ["White House Weighs Replacing Fed Chair Before Term Ends", "general"],
    ["President Names Nominee For Next Fed Chair", "general"],
    ["Dispute Grows Over Central Bank Independence Amid Political Pressure", "general"],
    ["Lawmakers Warn Bill Would Undermine Federal Reserve Independence", "general"],
    ["Fed Signals Rate Path Forward In New Guidance", "general"],
    ["ECB Outlook Shifts As Officials Weigh Next Steps", "forex"],
    // Real-world regression case from Phase 3H.2R: this previously fell to
    // Low because it contains no rate-decision keyword.
    [
      "Trump calls for Powell to resign over Fed renovation, asks attorney general to review report",
      "general",
    ],
    // Part 3 (Phase 3H.4): a recap/wrap headline that only mentions a macro
    // release in passing must not auto-High, but still carries meaningful
    // relevance and should land at Medium, not Low.
    [
      "investingLive Americas FX news wrap 30 Sept: Softer PCE fails to hold yields down; Dow ends September at June lows",
      "forex",
    ],
    ["Market Recap: CPI Data Boosts Stocks", "general"],
    ["Daily Wrap: NFP Report Beats Estimates, Markets Rally", "general"],
    ["Session Recap: GDP Growth Figures Lift Sentiment", "general"],
  ];

  for (const [headline, category] of cases) {
    it(`classifies "${headline}" as medium`, () => {
      expect(classifyImpact({ category, headline })).toBe("medium");
    });
  }
});

describe("classifyImpact: Low (fallback)", () => {
  const cases: Array<[string, "general" | "forex" | "crypto"]> = [
    ["Local Bakery Chain Announces New Menu Items", "general"],
    ["Market Recap: Quiet Trading Session Ends The Week", "forex"],
    ["Small Crypto Project Announces Routine Software Update", "crypto"],
    ["Composite Index Ticks Up Slightly In Thin Trading", "general"],
    // Routine central-bank presence with no comments/guidance/leadership
    // signal stays Low -- Part 6 widens Medium, it does not make every Fed
    // mention Medium.
    ["Regional Fed President Attends Economic Conference", "general"],
    ["Central Bank Official Gives Routine Speech At University", "general"],
  ];

  for (const [headline, category] of cases) {
    it(`classifies "${headline}" as low`, () => {
      expect(classifyImpact({ category, headline })).toBe("low");
    });
  }

  it("does not classify dramatic wording alone as high (false-positive resistance)", () => {
    expect(
      classifyImpact({
        category: "general",
        headline: "Huge Massive Shocking Crash Incoming, Analyst Warns",
      }),
    ).toBe("low");
  });

  it("falls back to low for a generic headline with no recognized signal", () => {
    expect(classifyImpact({ category: "general", headline: "Company Reports Ordinary Update" })).toBe(
      "low",
    );
  });
});

describe("classifyImpact: determinism", () => {
  it("returns the same result for the same input every time", () => {
    const input = { category: "general" as const, headline: "US CPI Inflation Report Due Today" };
    const first = classifyImpact(input);
    for (let i = 0; i < 5; i++) {
      expect(classifyImpact(input)).toBe(first);
    }
  });

  it("never uses the summary as an impact signal", () => {
    const withoutHint = classifyImpact({ category: "general", headline: "Routine Company Update" });
    // classifyImpact has no summary parameter at all -- passing extra fields
    // through a wider object cannot influence the result either.
    const withIrrelevantExtra = classifyImpact({
      category: "general",
      headline: "Routine Company Update",
      ...({ summary: "FOMC CPI GDP nonfarm payrolls" } as Record<string, unknown>),
    });
    expect(withIrrelevantExtra).toBe(withoutHint);
    expect(withoutHint).toBe("low");
  });
});

const BASE = {
  externalId: "1",
  provider: "finnhub",
  category: "general" as const,
  headline: "Composite Index Ticks Up Slightly In Thin Trading",
  source: "Fixture Wire",
  publishedAt: "2025-09-01T00:00:00.000Z",
  url: "https://example.com/article",
};

describe("validateNewsItem: impact wiring", () => {
  it("attaches a bullhaus_heuristic estimate to every normally-fetched item", () => {
    const item = validateNewsItem(BASE);
    expect(item.estimatedImpact).toBe("low");
    expect(item.impactSource).toBe("bullhaus_heuristic");
  });

  it("never overwrites a genuine provider-supplied impact rating", () => {
    const item = validateNewsItem({
      ...BASE,
      headline: "US CPI Inflation Report Due Today", // would otherwise classify as high
      estimatedImpact: "low",
      impactSource: "provider",
    });
    expect(item.estimatedImpact).toBe("low");
    expect(item.impactSource).toBe("provider");
  });

  it("ignores a partial provider hint (impactSource without estimatedImpact) and classifies instead", () => {
    const item = validateNewsItem({
      ...BASE,
      headline: "US CPI Inflation Report Due Today",
      impactSource: "provider",
    });
    expect(item.estimatedImpact).toBe("high");
    expect(item.impactSource).toBe("bullhaus_heuristic");
  });

  it("normalizes relatedSymbols to trimmed, upper-cased entries", () => {
    const item = validateNewsItem({ ...BASE, relatedSymbols: [" btc ", "eth"] });
    expect(item.relatedSymbols).toEqual(["BTC", "ETH"]);
  });
});
