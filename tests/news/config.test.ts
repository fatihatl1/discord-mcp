import { describe, expect, it } from "vitest";
import {
  isProviderPublishable,
  loadNewsConfig,
  skipReason,
  type NewsConfig,
} from "../../src/news/config.js";

describe("loadNewsConfig", () => {
  it("defaults to the safe side when nothing is set: dry-run on, publish off", () => {
    const config = loadNewsConfig({});
    expect(config.dryRun).toBe(true);
    expect(config.publishEnabled).toBe(false);
    expect(config.finnhubLicenseApproved).toBe(false);
    expect(config.maxAgeMinutes).toBe(60);
    expect(config.maxPostsPerChannel).toBe(3);
    expect(config.historyLookback).toBe(100);
    expect(config.providers).toEqual(["mock"]);
  });

  it("reads explicit overrides", () => {
    const config = loadNewsConfig({
      NEWS_DRY_RUN: "false",
      NEWS_PUBLISH_ENABLED: "true",
      NEWS_LICENSE_APPROVED: "true",
      NEWS_MAX_AGE_MINUTES: "30",
      NEWS_MAX_POSTS_PER_CHANNEL: "5",
      NEWS_PROVIDERS: "mock,finnhub,official_rss",
    });
    expect(config.dryRun).toBe(false);
    expect(config.publishEnabled).toBe(true);
    expect(config.finnhubLicenseApproved).toBe(true);
    expect(config.maxAgeMinutes).toBe(30);
    expect(config.maxPostsPerChannel).toBe(5);
    expect(config.providers).toEqual(["mock", "finnhub", "official_rss"]);
  });

  it("falls back to mock for unrecognized/empty provider lists", () => {
    expect(loadNewsConfig({ NEWS_PROVIDERS: "carrier_pigeon" }).providers).toEqual(["mock"]);
    expect(loadNewsConfig({ NEWS_PROVIDERS: "" }).providers).toEqual(["mock"]);
  });

  it("treats an invalid numeric override as the default rather than NaN/0", () => {
    expect(loadNewsConfig({ NEWS_MAX_AGE_MINUTES: "not-a-number" }).maxAgeMinutes).toBe(60);
    expect(loadNewsConfig({ NEWS_MAX_POSTS_PER_CHANNEL: "0" }).maxPostsPerChannel).toBe(3);
  });
});

function config(overrides: Partial<NewsConfig> = {}): NewsConfig {
  return {
    dryRun: false,
    publishEnabled: true,
    finnhubLicenseApproved: false,
    maxAgeMinutes: 60,
    maxPostsPerChannel: 3,
    historyLookback: 100,
    providers: ["mock"],
    ...overrides,
  };
}

describe("isProviderPublishable / skipReason", () => {
  it("blocks everything while dry-run is on, regardless of other flags", () => {
    const cfg = config({ dryRun: true, publishEnabled: true, finnhubLicenseApproved: true });
    expect(isProviderPublishable("finnhub", cfg)).toBe(false);
    expect(skipReason("finnhub", cfg)).toBe("dry_run");
  });

  it("blocks everything while publishing is disabled", () => {
    const cfg = config({ dryRun: false, publishEnabled: false });
    expect(isProviderPublishable("official_rss:fed_press_all", cfg)).toBe(false);
    expect(skipReason("official_rss:fed_press_all", cfg)).toBe("publish_disabled");
  });

  it("never allows the mock provider to publish live, even fully approved", () => {
    const cfg = config({ dryRun: false, publishEnabled: true, finnhubLicenseApproved: true });
    expect(isProviderPublishable("mock", cfg)).toBe(false);
    expect(skipReason("mock", cfg)).toBe("mock_provider_never_publishes_live");
  });

  it("gates finnhub on its own license flag, independent of RSS approval", () => {
    const notApproved = config({ dryRun: false, publishEnabled: true, finnhubLicenseApproved: false });
    expect(isProviderPublishable("finnhub", notApproved)).toBe(false);
    expect(skipReason("finnhub", notApproved)).toBe("finnhub_license_not_approved");

    const approved = config({ dryRun: false, publishEnabled: true, finnhubLicenseApproved: true });
    expect(isProviderPublishable("finnhub", approved)).toBe(true);
  });

  it("does not cascade: approving finnhub does not approve RSS, and vice versa", () => {
    const cfg = config({ dryRun: false, publishEnabled: true, finnhubLicenseApproved: true });
    expect(isProviderPublishable("official_rss:ecb_press", cfg)).toBe(true); // gated upstream by per-source approval already
    const cfg2 = config({ dryRun: false, publishEnabled: true, finnhubLicenseApproved: false });
    expect(isProviderPublishable("official_rss:ecb_press", cfg2)).toBe(true); // unaffected by finnhub's flag
    expect(isProviderPublishable("finnhub", cfg2)).toBe(false);
  });

  it("never trusts an unrecognized provider id", () => {
    const cfg = config({ dryRun: false, publishEnabled: true });
    expect(isProviderPublishable("mystery_provider", cfg)).toBe(false);
  });
});
