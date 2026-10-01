/**
 * Renders a NewsItem into the exact publication format (Phase 3H.5, Part 5):
 *
 *   **Headline**
 *   Publisher · HH:MM CET/CEST
 *   Estimated Impact: High
 *   [Read article](ARTICLE_URL)
 *
 * No emojis, no article body/summary, no images -- just headline, publisher,
 * Europe/Zurich local time, the BULLHAUS-owned Estimated Impact estimate,
 * and the original link. Discord markdown control characters and mention
 * syntax are neutralized so a headline can never inject formatting, an
 * unintended @everyone/@here, or a role/user ping. "Estimated Impact" is
 * always exactly one of Low/Medium/High -- never "Finnhub Impact" and never
 * implying the value came from a provider (see impact.ts).
 */

import type { EstimatedImpact } from "./impact.js";
import type { NewsItem } from "./types.js";

const MAX_MESSAGE_LENGTH = 2000;

/**
 * Escapes characters with inline markdown meaning (bold/italic/strike/code/
 * spoiler) so they render literally anywhere in the line. ">" and "#" are
 * deliberately NOT escaped here: both only take effect at the true start of
 * a message line, and the headline is always preceded by "**", so neither
 * can ever trigger blockquote/heading rendering in this format.
 */
function escapeDiscordMarkdown(text: string): string {
  return text.replace(/([\\*_~`|])/g, "\\$1");
}

/** Breaks up every "@" so @everyone/@here/<@id>/<@&id> can never resolve as a mention. */
function neutralizeMentions(text: string): string {
  return text.replace(/@/g, "@​");
}

function sanitizeText(text: string): string {
  return neutralizeMentions(escapeDiscordMarkdown(text));
}

const ZURICH_TIME_ZONE = "Europe/Zurich";

// Formats the wall-clock hour/minute/second Europe/Zurich would show for a
// given instant. Deliberately does NOT rely on Intl's timeZoneName output
// (format "short" is inconsistent across locales/ICU builds -- it can yield
// "GMT+2" instead of "CEST") -- only the timeZone-aware hour/minute/day
// fields are used, which every Node build with ICU/tzdata support resolves
// correctly for Europe/Zurich.
const zurichPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: ZURICH_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function zurichWallClock(ms: number): { hour: number; minute: number; asUtcMs: number } {
  const parts = zurichPartsFormatter.formatToParts(new Date(ms));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? NaN);
  const year = get("year");
  const month = get("month");
  const day = get("day");
  // Some ICU builds render midnight as hour "24" rather than "00" under
  // hour12:false -- normalize it.
  let hour = get("hour");
  if (hour === 24) hour = 0;
  const minute = get("minute");
  const second = get("second");
  // Re-interpreting the Zurich wall-clock fields as if they were UTC and
  // diffing against the real UTC instant yields the Zurich UTC offset at
  // that moment directly, with no dependency on any abbreviation string.
  const asUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  return { hour, minute, asUtcMs };
}

/**
 * Renders the Europe/Zurich local time for an ISO-8601 instant as
 * "HH:MM CET" or "HH:MM CEST", deriving the abbreviation from the actual
 * UTC+01:00/UTC+02:00 offset (Part 3) rather than trusting a potentially
 * unreliable Intl-provided abbreviation string. Switzerland observes only
 * these two offsets, so this covers every real input.
 */
export function formatZurichTime(publishedAtIso: string): string {
  const ms = Date.parse(publishedAtIso);
  const { hour, minute, asUtcMs } = zurichWallClock(ms);
  const offsetMinutes = Math.round((asUtcMs - ms) / 60_000);
  const abbreviation = offsetMinutes >= 90 ? "CEST" : "CET";
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return `${hh}:${mm} ${abbreviation}`;
}

const IMPACT_LABELS: Record<EstimatedImpact, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

function formatImpactLine(impact: EstimatedImpact): string {
  return `Estimated Impact: ${IMPACT_LABELS[impact]}`;
}

export function formatNewsMessage(item: NewsItem): string {
  const headline = sanitizeText(item.headline);
  const publisher = sanitizeText(item.source);
  const time = formatZurichTime(item.publishedAt);

  const publisherLine = `${publisher} · ${time}`;
  const impactLine = formatImpactLine(item.estimatedImpact);
  const linkLine = `[Read article](${item.url})`;

  let headlineForLine = headline;
  let message = `**${headlineForLine}**\n${publisherLine}\n${impactLine}\n${linkLine}`;

  if (message.length > MAX_MESSAGE_LENGTH) {
    const overhead = message.length - headline.length;
    const budget = Math.max(0, MAX_MESSAGE_LENGTH - overhead - 1);
    headlineForLine = budget > 0 ? `${headline.slice(0, budget)}…` : "…";
    message = `**${headlineForLine}**\n${publisherLine}\n${impactLine}\n${linkLine}`;
  }

  return message;
}
