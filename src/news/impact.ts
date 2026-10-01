/**
 * BULLHAUS-owned "Estimated Impact" heuristic (Low / Medium / High).
 *
 * This is NOT a Finnhub field and must never be presented as one -- Finnhub
 * Market News carries no authoritative impact rating. `impactSource` records
 * that distinction so a future provider that DOES supply a genuine impact
 * field (impactSource: "provider") is never silently overwritten by this
 * heuristic (see types.ts#validateNewsItem).
 *
 * Deterministic and transparent by design: plain keyword/phrase matching
 * against the headline (never the summary -- Part 5/7), no external AI call,
 * no use of future price movement. Conservative on purpose (Part 8): dramatic
 * wording alone never reaches High, only the specific signals below do.
 */

import type { NewsCategory } from "../config/bullhaus.js";

export type EstimatedImpact = "low" | "medium" | "high";
export type ImpactSource = "bullhaus_heuristic" | "provider";

export interface ImpactClassifierInput {
  category: NewsCategory;
  headline: string;
  /** Accepted for forward compatibility (Part 7); not required by any rule below. */
  source?: string | undefined;
  /** Finnhub's `related` field, when populated. Used only for the crypto-ETF rule. */
  relatedSymbols?: readonly string[] | undefined;
}

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

function matchesAll(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.every((p) => p.test(text));
}

// --- High: monetary policy -------------------------------------------------
const HIGH_MONETARY_POLICY: readonly RegExp[] = [
  /\bfomc\b/i,
  /\bfed rate decision\b/i,
  /\bfederal reserve\b.{0,40}\brate decision\b/i,
  /\becb rate decision\b/i,
  /\bbank of england rate decision\b/i,
  /\bboe rate decision\b/i,
  /\bbank of japan rate decision\b/i,
  /\bboj rate decision\b/i,
  /\bsnb rate decision\b/i,
  /\bswiss national bank rate decision\b/i,
  /\binterest[- ]rate decision\b/i,
  /\bemergency rate (action|decision)\b/i,
  /\bmonetary[- ]policy decision\b/i,
];

// --- High: major macro releases ---------------------------------------------
const HIGH_MACRO: readonly RegExp[] = [
  /\bcpi\b/i,
  /\binflation report\b/i,
  /\bpce\b/i,
  /\bnonfarm payrolls\b/i,
  /\bnfp\b/i,
  /\bjobs report\b/i,
  /\bunemployment rate\b/i,
  /\bgdp\b/i,
  /\bmajor employment data\b/i,
];

// --- High: major systemic events --------------------------------------------
const HIGH_SYSTEMIC: readonly RegExp[] = [
  /\bgovernment default\b/i,
  /\bsovereign default\b/i,
  /\bbanking crisis\b/i,
  /\bemergency central[- ]bank (action|intervention)\b/i,
  /\bemergency government (financial )?intervention\b/i,
  /\bmajor market[- ]wide trading halt\b/i,
  /\bmajor geopolitical escalation\b/i,
];

// --- Recap/commentary detection (Phase 3H.4, Part 3) ------------------------
// A headline that is explicitly a recap/wrap of a trading session must not
// become High solely because it *mentions* a major macro release in passing
// (e.g. "...news wrap 30 Sept: Softer PCE fails to hold yields down...") --
// that is commentary about the session, not the primary publication of the
// release itself. This demotion applies ONLY to the HIGH_MACRO group below;
// it never touches monetary-policy decisions, systemic events, or crypto
// major-event rules, so a genuine policy decision or emergency event inside
// a "wrap" headline (e.g. "FOMC Recap: Fed Holds Rates Steady") still
// classifies High via those independent rules.
const RECAP_PATTERNS: readonly RegExp[] = [
  /\bnews wrap\b/i,
  /\bmarket wrap\b/i,
  /\bdaily wrap\b/i,
  /\brecap\b/i,
  /\bmarket recap\b/i,
  /\bsession recap\b/i,
];

function isRecapHeadline(headline: string): boolean {
  return matchesAny(headline, RECAP_PATTERNS);
}

// --- High: crypto-specific major events (compound, AND-of-groups) ----------
const CRYPTO_ETF_COINS: readonly RegExp[] = [/\bbitcoin\b/i, /\bethereum\b/i];
const CRYPTO_ETF_COIN_SYMBOLS = new Set(["BTC", "ETH", "BITCOIN", "ETHEREUM"]);

function isCryptoEtfDecisionHeadline(
  headline: string,
  relatedSymbols: readonly string[] | undefined,
): boolean {
  const mentionsEtf = /\betf\b/i.test(headline);
  const mentionsDecision = /\b(approv\w*|reject\w*|denial|denied|decision)\b/i.test(headline);
  if (!mentionsEtf || !mentionsDecision) return false;
  if (matchesAny(headline, CRYPTO_ETF_COINS)) return true;
  return (relatedSymbols ?? []).some((s) => CRYPTO_ETF_COIN_SYMBOLS.has(s.toUpperCase()));
}

const HIGH_CRYPTO_COMPOUND: readonly (readonly RegExp[])[] = [
  [/\bexchange\b/i, /\b(insolvency|insolvent|bankrupt\w*)\b/i],
  [/\bmajor\b/i, /\bexchange\b/i, /\bhack\w*\b/i],
  [/\bsec\b/i, /\bcrypto\w*\b/i, /\benforcement\b/i],
  [/\bcourt\b/i, /\b(ruling|decision)\b/i, /\bcrypto\w*\b/i],
  [/\b(government|regulator\w*)\b/i, /\b(prohibit\w*|ban\w*|approv\w*)\b/i, /\b(crypto\w*|bitcoin|cryptocurrency)\b/i],
];

// --- Medium signals ----------------------------------------------------------
const MEDIUM_PATTERNS: readonly RegExp[] = [
  /\bcentral bank comments\b/i,
  /\bfed (chair|chairman|officials?) comments?\b/i,
  /\becb (president|officials?) comments?\b/i,
  /\bearnings (beat|miss)\b/i,
  /\bguidance (cut|raised|lowered|increased)\b/i,
  /\bquarterly (earnings|results)\b/i,
  /\b(merger|acquisition|buyout|to acquire)\b/i,
  /\bregulatory (development|change|proposal|reform)\b/i,
  /\b(oil|gas|commodity) supply\b/i,
  /\bopec\b/i,
  /\bproduction cut\b/i,
  /\bsupply disruption\b/i,
  /\banalyst (upgrade|downgrade)s?\b/i,
  /\bprice target (raised|cut|increased|lowered)\b/i,
  /\boutlook (raised|cut|upgraded|downgraded)\b/i,
  /\bcrypto\w* regulat\w*\b/i,
  /\betf (inflows?|outflows?|flows?)\b/i,
  /\binstitutional (investment|adoption|crypto)\b/i,
  /\b(retail sales|pmi|manufacturing index|trade balance|industrial production)\b/i,
  // Central-bank guidance/signaling short of an actual rate decision (Part 6).
  /\b(fed|federal reserve|ecb|bank of england|boe|bank of japan|boj) (guidance|outlook|signals?)\b/i,
  /\bforward guidance\b/i,
  /\bcentral bank guidance\b/i,
];

// --- Medium: Fed/central-bank leadership and independence (Part 6) ---------
// Covers a credible Fed Chair resignation, removal, or replacement, and a
// significant dispute over central-bank independence -- e.g. a president
// publicly pressuring a sitting Fed Chair to resign. This must reach at
// least Medium rather than falling to Low merely because it lacks a
// rate-decision keyword (the real-world regression case from Phase 3H.2R:
// "Trump calls for Powell to resign over Fed renovation...").
const FED_CHAIR_PERSON: readonly RegExp[] = [
  /\bfed chair\w*\b/i,
  /\bfederal reserve chair\w*\b/i,
  /\bpowell\b/i,
];
const CHAIR_LEADERSHIP_CHANGE: readonly RegExp[] = [
  /\bresign\w*\b/i,
  /\bsteps? down\b/i,
  /\bstepping down\b/i,
  /\bremov\w*\b/i,
  /\bfired\b/i,
  /\bfiring\b/i,
  /\boust\w*\b/i,
  /\bdismiss\w*\b/i,
  /\breplac\w*\b/i,
  /\bsuccessor\b/i,
  /\bnominee\b/i,
  /\bnominat\w*\b/i,
];
const CENTRAL_BANK_INDEPENDENCE: readonly RegExp[] = [
  /\bcentral bank independence\b/i,
  /\bfed(eral reserve)? independence\b/i,
  /\b(threatens?|undermin\w*|erod\w*|pressur\w*) .*\bindependence\b/i,
];

function isHigh(headline: string, relatedSymbols: readonly string[] | undefined): boolean {
  if (matchesAny(headline, HIGH_MONETARY_POLICY)) return true;
  if (matchesAny(headline, HIGH_SYSTEMIC)) return true;
  if (isCryptoEtfDecisionHeadline(headline, relatedSymbols)) return true;
  if (HIGH_CRYPTO_COMPOUND.some((group) => matchesAll(headline, group))) return true;
  if (matchesAny(headline, HIGH_MACRO)) {
    // A recap/wrap headline that merely mentions a macro release is not the
    // release itself -- demote to (at least) Medium instead (Part 3).
    if (isRecapHeadline(headline)) return false;
    return true;
  }
  return false;
}

function isFedChairLeadershipChange(headline: string): boolean {
  return matchesAny(headline, FED_CHAIR_PERSON) && matchesAny(headline, CHAIR_LEADERSHIP_CHANGE);
}

function isMedium(headline: string): boolean {
  if (matchesAny(headline, MEDIUM_PATTERNS)) return true;
  if (isFedChairLeadershipChange(headline)) return true;
  if (matchesAny(headline, CENTRAL_BANK_INDEPENDENCE)) return true;
  // A recap/wrap headline demoted out of High (isHigh, Part 3) for merely
  // mentioning a major macro release still carries meaningful relevance.
  if (isRecapHeadline(headline) && matchesAny(headline, HIGH_MACRO)) return true;
  return false;
}

/**
 * Classifies estimated importance from content available at publication time
 * only (headline + category, optionally related symbols). Never uses actual
 * or future price movement, and never produces a trade direction, price
 * target, or probability forecast -- only Low/Medium/High. Low is always the
 * fallback when nothing more specific matches (Part 10).
 */
export function classifyImpact(input: ImpactClassifierInput): EstimatedImpact {
  const headline = input.headline;
  if (isHigh(headline, input.relatedSymbols)) return "high";
  if (isMedium(headline)) return "medium";
  return "low";
}
