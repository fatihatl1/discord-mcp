/**
 * News Worker environment configuration and publication-approval gates
 * (Parts M/L/13). Every safety-relevant value defaults to the safe side when
 * unset: dry-run ON, publishing OFF, no provider pre-approved.
 */

export type ProviderName = "mock" | "finnhub" | "official_rss";

const KNOWN_PROVIDERS: readonly ProviderName[] = ["mock", "finnhub", "official_rss"];

function isProviderName(value: string): value is ProviderName {
  return (KNOWN_PROVIDERS as readonly string[]).includes(value);
}

export interface NewsConfig {
  /** Default true. While true, no Discord write of any kind happens. */
  dryRun: boolean;
  /** Default false. Master publish switch; still gated per-provider below. */
  publishEnabled: boolean;
  /** Default false. Finnhub-specific redistribution approval (Part 13). */
  finnhubLicenseApproved: boolean;
  maxAgeMinutes: number;
  maxPostsPerChannel: number;
  /** How many recent channel messages the dedup check scans. Default 100. */
  historyLookback: number;
  providers: ProviderName[];
}

function envFlag(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: boolean,
): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return defaultValue;
  return raw === "true" || raw === "1" || raw === "yes";
}

function envInt(env: NodeJS.ProcessEnv, name: string, defaultValue: number): number {
  const raw = env[name];
  if (!raw) return defaultValue;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : defaultValue;
}

export function loadNewsConfig(env: NodeJS.ProcessEnv = process.env): NewsConfig {
  const providersRaw = env["NEWS_PROVIDERS"]?.trim();
  const providers = providersRaw
    ? providersRaw
        .split(",")
        .map((s) => s.trim())
        .filter(isProviderName)
    : (["mock"] as ProviderName[]);

  return {
    dryRun: envFlag(env, "NEWS_DRY_RUN", true),
    publishEnabled: envFlag(env, "NEWS_PUBLISH_ENABLED", false),
    finnhubLicenseApproved: envFlag(env, "NEWS_LICENSE_APPROVED", false),
    maxAgeMinutes: envInt(env, "NEWS_MAX_AGE_MINUTES", 60),
    maxPostsPerChannel: envInt(env, "NEWS_MAX_POSTS_PER_CHANNEL", 3),
    historyLookback: envInt(env, "NEWS_HISTORY_LOOKBACK", 100),
    providers: providers.length > 0 ? providers : (["mock"] as ProviderName[]),
  };
}

/**
 * Whether an item from this provider may ever be sent live to Discord.
 * Approvals are per-provider and never cascade: approving Finnhub does not
 * approve RSS sources and vice versa (Part 13/27). The Mock Provider is
 * hard-blocked from live publication no matter what is configured -- its
 * fixtures must never reach production channels (Part 11).
 */
export function isProviderPublishable(providerId: string, config: NewsConfig): boolean {
  if (config.dryRun) return false;
  if (!config.publishEnabled) return false;
  if (providerId === "mock") return false;
  if (providerId === "finnhub") return config.finnhubLicenseApproved;
  if (providerId.startsWith("official_rss:")) {
    // Per-source approval already gated whether this item was ever fetched
    // (rss/sources.ts enabledApprovedSources); reaching here means it passed.
    return true;
  }
  return false;
}

export function skipReason(providerId: string, config: NewsConfig): string {
  if (config.dryRun) return "dry_run";
  if (!config.publishEnabled) return "publish_disabled";
  if (providerId === "mock") return "mock_provider_never_publishes_live";
  if (providerId === "finnhub") return "finnhub_license_not_approved";
  if (providerId.startsWith("official_rss:")) return "rss_source_not_approved";
  return "provider_not_recognized";
}
