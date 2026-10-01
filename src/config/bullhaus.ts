/**
 * Central BULLHAUS configuration: the one guild every tool is restricted to,
 * and the final (Phase 3G.3) News channel mapping.
 *
 * Keeping these ids here -- instead of scattered through tool/provider code
 * -- means the Owner can repoint a channel by editing one place, and every
 * guild-restricted tool shares one definition of "the BULLHAUS guild".
 */

import { isSnowflake } from "../discord/snowflake.js";

function requireSnowflake(label: string, value: string): string {
  if (!isSnowflake(value)) {
    throw new Error(`Configured ${label} "${value}" is not a valid Discord snowflake.`);
  }
  return value;
}

/** The single Discord guild all BULLHAUS tooling operates against. */
export const BULLHAUS_GUILD_ID: string = requireSnowflake(
  "BULLHAUS guild id",
  process.env["DISCORD_GUILD_ID"]?.trim() || "1307135789364154459",
);

export function isBullhausGuild(guildId: string): boolean {
  return guildId === BULLHAUS_GUILD_ID;
}

export type NewsCategory = "general" | "forex" | "crypto";

export const NEWS_CATEGORIES: readonly NewsCategory[] = ["general", "forex", "crypto"];

/**
 * Final News channel ids from the Phase 3G.3 recreation. The previous News
 * channels were deleted; their old ids must never be reused here.
 */
export const NEWS_CHANNELS: Readonly<Record<NewsCategory, string>> = Object.freeze({
  general: requireSnowflake("general news channel id", "1554782909272039476"), // Trading News
  forex: requireSnowflake("forex news channel id", "1554783055535804470"), // Forex News
  crypto: requireSnowflake("crypto news channel id", "1554838955294195863"), // Crypto News
});

export function newsChannelId(category: NewsCategory): string {
  return NEWS_CHANNELS[category];
}
