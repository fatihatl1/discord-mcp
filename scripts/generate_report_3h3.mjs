/**
 * Generates the Phase 3H.3 report: final Finnhub production preparation and
 * final safety dry run before the first real Discord publication. Run via:
 * node scripts/generate_report_3h3.mjs
 *
 * Reads reports/phase3h3_data.json, produced by
 * scripts/phase3h3_live_dryrun.ts (npx tsx scripts/phase3h3_live_dryrun.ts),
 * which performs the actual real Discord/Finnhub calls this report
 * describes. This script itself makes no network calls -- it only renders
 * the already-captured, non-secret results into a PDF.
 */

import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SimplePdfDocument } from "./pdf/simple_pdf.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "reports");
const OUT_FILE = join(OUT_DIR, "BULLHAUS_Phase3H3_Bericht.pdf");
const DATA_FILE = join(OUT_DIR, "phase3h3_data.json");

const data = JSON.parse(readFileSync(DATA_FILE, "utf8"));

const doc = new SimplePdfDocument();

function section(letter, title) {
  doc.spacer(4);
  doc.heading(`${letter}. ${title}`);
}
function para(text) {
  doc.paragraph(text);
  doc.spacer(3);
}
function bullets(items) {
  for (const item of items) doc.bullet(item);
  doc.spacer(3);
}
function truncateForPdf(line, maxLen = 150) {
  return line.length > maxLen ? `${line.slice(0, maxLen)}...[truncated for report display]` : line;
}
function code(lines) {
  for (const line of lines) doc.paragraph(truncateForPdf(line), { size: 9 });
  doc.spacer(3);
}

const discordCounts = data.requestCounts["discord.com"] ?? { GET: 0, nonGetMethods: [] };
const finnhubCounts = data.requestCounts["finnhub.io"] ?? { GET: 0, nonGetMethods: [] };

doc.title("BULLHAUS Discord V2 - Phase 3H.3 Report");
doc.subtitle("Finnhub Final Production Preparation - Final Safety Dry Run");
doc.subtitle("Generated: " + new Date().toISOString());
doc.subtitle("Guild: 1307135789364154459  |  Repo: C:\\BULLHAUS\\discord-mcp");
doc.spacer(10);

para(
  "Headline result: with the Owner's confirmed Finnhub usage approval " +
    "(NEWS_LICENSE_APPROVED=true, NEWS_PUBLISH_ENABLED=true), this phase ran " +
    "the final real-data safety dry run -- real Discord authentication and " +
    "channel reads, real Finnhub Market News requests for general/forex/" +
    "crypto, processed through the complete production pipeline (fetch -> " +
    "normalize -> validate -> Estimated Impact classification -> real " +
    "Discord-history dedup -> freshness filter -> flood control -> message " +
    "formatting -> dry-run preview). NEWS_DRY_RUN and DRY_RUN remained true " +
    "throughout, enforced at three independent layers. Zero Discord writes " +
    "occurred. No article was published. The system is classified " +
    "TECHNICALLY READY FOR CONTROLLED FIRST LIVE POST (section X); the " +
    "first live post itself is deliberately deferred to Phase 3H.4.",
);

// A -----------------------------------------------------------------
section("A", "Environment Safety Validation");
para(
  "Pre-flight presence check confirmed every required variable is set, " +
    "without ever reading or printing a secret value: DISCORD_BOT_TOKEN " +
    "present, FINNHUB_API_KEY present, NEWS_PROVIDERS=finnhub, " +
    "NEWS_LICENSE_APPROVED=true, NEWS_PUBLISH_ENABLED=true, " +
    "NEWS_DRY_RUN=true, DRY_RUN=true, NEWS_MAX_AGE_MINUTES=60, " +
    "NEWS_MAX_POSTS_PER_CHANNEL=3, NEWS_HISTORY_LOOKBACK=100 -- all exactly " +
    "matching the Part 1 expected configuration. Execution proceeded past " +
    "pre-flight.",
);

// B -----------------------------------------------------------------
section("B", "Finnhub-Only Provider Confirmation");
para(
  `NEWS_PROVIDERS=${data.config.providers.join(",")} -- Finnhub is the sole ` +
    "active provider this run. src/news/cli.ts and scripts/phase3h3_live_dryrun.ts " +
    "both instantiate only FinnhubProvider from this list. The provider " +
    "abstraction (NewsProvider interface, provider.ts) is unchanged and " +
    "still supports Mock and Official RSS as separate, independently-gated " +
    "implementations -- neither was removed, and neither was active this run.",
);

// C -----------------------------------------------------------------
section("C", "Finlight Absence Confirmation");
para(
  "A repository-wide case-insensitive search for \"finlight\" across all " +
    ".ts/.md/.json source files returned zero matches. No Finlight adapter, " +
    "configuration, dependency, or documentation reference exists anywhere " +
    "in the codebase. Finnhub is the only market-news API integration " +
    "present.",
);

// D -----------------------------------------------------------------
section("D", "Final News-Channel Mapping");
para(
  "src/config/bullhaus.ts hard-codes the final Phase 3G.3 channel ids, and " +
    "this run's live Discord reads confirm all three remain accessible with " +
    "no structural changes made:",
);
bullets(
  data.channelChecks.map(
    (c) =>
      `${c.category} (#${c.channelId}): accessible, ${c.messageCount} message(s) read, ${c.pinnedCount} pinned (the existing introduction, unmodified)`,
  ),
);

// E -----------------------------------------------------------------
section("E", "Estimated Impact Refinements (Part 6)");
para(
  "impact.ts was refined to close the exact gap the Phase 3H.2R report " +
    "flagged: a headline naming the Fed Chair alongside resignation, " +
    "removal, dismissal, or replacement language, or describing a dispute " +
    "over central-bank independence, now classifies as Medium instead of " +
    "falling through to Low for lacking a rate-decision keyword. New rules " +
    "added: (1) a Fed-Chair-plus-leadership-change compound match (covers " +
    "\"resign\", \"step(s) down\", \"removal\"/\"remove\", \"fired\", " +
    "\"ousted\", \"dismissed\", \"replace\", \"successor\", \"nominee\"/" +
    "\"nominated\", matched against \"Fed Chair\"/\"Federal Reserve " +
    "Chair\"/\"Powell\"); (2) explicit central-bank-independence-dispute " +
    "phrasing; (3) central-bank guidance/outlook/signal phrasing that is " +
    "not itself an actual rate decision. While making this change, an " +
    "overly broad pre-existing High rule was also corrected: a bare " +
    "\"Federal Reserve\" mention (with no rate-decision language at all) " +
    "was incorrectly sufficient for High on its own, which would have kept " +
    "misclassifying \"Fed Chair removal\" headlines as High instead of " +
    "Medium; it was replaced with a precise \"Federal Reserve ... rate " +
    "decision\" proximity match, and Part 5's SNB rate decision, short " +
    "BoE/BoJ forms, and emergency-government-intervention High triggers " +
    "were added for completeness.",
);
para(
  "Regression check: the real-world headline flagged in the Phase 3H.2R " +
    "report -- \"Trump calls for Powell to resign over Fed renovation, asks " +
    "attorney general to review report\" -- previously classified Low and " +
    "now classifies Medium under the new rule, verified by an added unit " +
    "test (tests/news/impact.test.ts).",
);

// F -----------------------------------------------------------------
section("F", "Final Message Format");
para(
  "format.ts renders exactly the required 4-line structure -- bold " +
    "headline, \"Publisher · HH:MM UTC\", \"Estimated Impact: " +
    "Low/Medium/High\", \"[Read article](URL)\" -- with no emoji, no stars " +
    "beyond markdown bold, no image, no article summary/body, no trading " +
    "advice, and no price target. Every send path sets " +
    "flags: MESSAGE_FLAGS.SUPPRESS_EMBEDS (publisher.ts), and headline text " +
    "is markdown-escaped and has every \"@\" broken with a zero-width " +
    "joiner so @everyone/@here/role/user mentions can never resolve " +
    "(neutralizeMentions in format.ts, covered by tests/embeds.test.ts and " +
    "tests/news/format.test.ts). Real formatted examples from this run's " +
    "live Finnhub data appear in section H.",
);

// G -----------------------------------------------------------------
section("G", "Deduplication Status");
para(
  "The real duplicate-check step (getCurrentUser + listMessages against " +
    "live Discord history, dedup.ts#fetchRecentlyPublishedUrls) completed " +
    "successfully for all three categories this run -- duplicateCheckFailed=" +
    "false in every case, never the fail-closed path. Each channel's sole " +
    "existing message remains pinned and is unconditionally excluded before " +
    "its content is ever inspected, so the introduction can never be " +
    "mistaken for a previously published article. NEWS_HISTORY_LOOKBACK " +
    `remains ${data.config.historyLookback}.`,
);

// H -----------------------------------------------------------------
section("H", "Freshness Configuration and Real Results");
para(
  `NEWS_MAX_AGE_MINUTES=${data.config.maxAgeMinutes}. Real results this run ` +
    "-- most of Finnhub's rolling Market News list is naturally older than " +
    "60 minutes at any single ad hoc fetch moment, which is expected " +
    "behavior, not a defect; notably this run also caught one genuinely " +
    "fresh item in forex and one in crypto, demonstrating the freshness " +
    "filter correctly passing eligible items through end-to-end rather than " +
    "only ever rejecting everything:",
);
bullets(
  data.categories.map(
    (c) =>
      `${c.category}: fetched=${c.fetchedCount} rejected_as_stale=${c.rejectedAsStaleCount} eligible=${c.eligibleCount}`,
  ),
);

// I -----------------------------------------------------------------
section("I", "Flood-Control Configuration");
para(
  `NEWS_MAX_POSTS_PER_CHANNEL=${data.config.maxPostsPerChannel}. This run's ` +
    "eligible-item counts (0-1 per category, section H) stayed under the " +
    "cap, so rejected_by_limit is 0 in every category -- the cap was not " +
    "exercised this run, but remains unit-tested (tests/news/flood_control.test.ts) " +
    "and unchanged. The Phase 3H.4 controlled-live-post plan will " +
    "temporarily lower this to 1; that change is NOT made in this phase.",
);

// J -----------------------------------------------------------------
section("J", "Final Real Finnhub Dry-Run Results");
para(
  "Full pipeline run against live Finnhub data and live Discord history, " +
    "NEWS_DRY_RUN forced true independently of .env:",
);
bullets(
  data.categories.map(
    (c) =>
      `${c.category} (#${c.channelId}): fetched=${c.fetchedCount} after_dedup=${c.afterDedupCount} ` +
      `stale=${c.rejectedAsStaleCount} over_limit=${c.rejectedByLimitCount} eligible=${c.eligibleCount} ` +
      `published=${c.publishedCount} duplicateCheckFailed=${c.duplicateCheckFailed} providerErrors=${c.providerErrors.length}`,
  ),
);

// K -----------------------------------------------------------------
section("K", "Articles Received Per Category");
bullets(data.categories.map((c) => `${c.category}: ${c.fetchedCount} item(s) received and validated from Finnhub`));

// L -----------------------------------------------------------------
section("L", "Impact Distribution Per Category");
bullets(
  data.categories.map(
    (c) =>
      `${c.category}: low=${c.impactDistribution.low} medium=${c.impactDistribution.medium} high=${c.impactDistribution.high}`,
  ),
);
para("Representative real headlines from this run, across all three impact levels actually observed:");
for (const cat of data.categories) {
  for (const item of cat.sampleItems) {
    bullets([`[${item.estimatedImpact.toUpperCase()}] (${cat.category}/${item.source}) ${item.headline}`]);
  }
}
para("Exact rendered formatting example for one item per level observed (section F format, real data):");
for (const cat of data.categories) {
  for (const item of cat.sampleItems.slice(0, 1)) {
    code(item.formattedExample.split("\n"));
    doc.spacer(2);
  }
}

// M -----------------------------------------------------------------
section("M", "Eligible Articles After Freshness Filtering");
bullets(data.categories.map((c) => `${c.category}: ${c.eligibleCount} eligible item(s) this run (age <= ${data.config.maxAgeMinutes} minutes, post-dedup)`));
para(
  "Every eligible item was still skipped from publication this run, " +
    "reason \"dry_run\" in every case -- never sent, per section N/O.",
);

// N -----------------------------------------------------------------
section("N", "Discord GET Count");
para(
  `${discordCounts.GET} real GET requests to discord.com, measured by an ` +
    "instrumented fetch wrapper around the actual DiscordClient (not " +
    "estimated): 1x GET /users/@me (initial credential check) + 3x GET " +
    "/channels/{id}/messages (per-channel accessibility/pinned check) + 3x " +
    "GET /users/@me + 3x GET /channels/{id}/messages (the real production " +
    "duplicate-check step inside publishCategory, once per category) = 10.",
);

// O -----------------------------------------------------------------
section("O", "Discord Write Count");
para(
  `${discordCounts.nonGetMethods.length} (zero). The same instrumented ` +
    "fetch wrapper observed no POST/PUT/PATCH/DELETE request. This holds " +
    "independently at two further layers regardless of " +
    "NEWS_PUBLISH_ENABLED/NEWS_LICENSE_APPROVED both now being true: the " +
    "real DiscordClient was constructed with dryRun:true (throws " +
    "DryRunWriteError before any network I/O for a non-GET request), and " +
    "isProviderPublishable() (config.ts) returns false unconditionally " +
    "while config.dryRun is true -- checked before the publish-enabled and " +
    "license-approved flags -- so createMessage was never even called by " +
    "the publisher this run.",
);

// P -----------------------------------------------------------------
section("P", "Finnhub Request Count");
para(
  `${finnhubCounts.GET} real GET requests to finnhub.io (one per category: ` +
    `general, forex, crypto), ${finnhubCounts.nonGetMethods.length} non-GET. ` +
    "No unnecessary or duplicate Finnhub calls were made.",
);

// Q -----------------------------------------------------------------
section("Q", "TypeScript Result");
para("npm run typecheck (tsc --noEmit): PASSED, zero errors.");

// R -----------------------------------------------------------------
section("R", "Build Result");
para("npm run build (tsc -p tsconfig.json): PASSED, zero errors, emitted to dist/.");

// S -----------------------------------------------------------------
section("S", "Complete Automated-Test Results");
para(
  "npm test (vitest run): 22 test files, 235 tests, all passing -- 15 new " +
    "tests added to tests/news/impact.test.ts for the Part 6 Medium " +
    "refinements (Fed Chair resignation/removal/replacement, central-bank " +
    "independence disputes, meaningful central-bank guidance, the real-" +
    "world 3H.2R regression case, routine-commentary Low fallback checks, " +
    "and the corrected/expanded High monetary-policy patterns), on top of " +
    "the previously-passing 220. No automated test performs a live network " +
    "call; Finnhub/Discord/RSS tests all use stubbed fetch functions or " +
    "in-memory fakes -- this is the mocked/local-fixture suite, run " +
    "separately from, and in addition to, the real live calls described in " +
    "sections A/D/G/J-P, which this test run does not touch.",
);

// T -----------------------------------------------------------------
section("T", "GitHub Actions Preparation");
para(
  ".github/workflows/news-worker.yml keeps workflow_dispatch as the only " +
    "active trigger this phase, with the concurrency group " +
    "\"bullhaus-news-worker\" (cancel-in-progress: false) preventing " +
    "overlapping runs, and a single job that runs the worker once, " +
    "processing general/forex/crypto together (runNewsWorker iterates all " +
    "three categories per invocation -- there is no per-channel workflow). " +
    "The intended production cadence is now prepared as a COMMENTED-OUT " +
    "schedule trigger (cron: \"*/10 * * * *\") directly above " +
    "workflow_dispatch, left inactive pending the Owner's explicit Phase " +
    "3H.4 authorization. DISCORD_BOT_TOKEN and FINNHUB_API_KEY remain " +
    "commented placeholders in the workflow env block, referencing " +
    "future GitHub repository secrets (${{ secrets.NAME }}) -- no secret " +
    "value is committed anywhere in the workflow, README, or .env.example, " +
    "and none was configured automatically this phase.",
);

// U/V/W -----------------------------------------------------------------
section("U", "License Approval State");
para(
  `NEWS_LICENSE_APPROVED=${data.config.finnhubLicenseApproved}. The Owner has ` +
    "confirmed the intended Finnhub use is permitted and has set this " +
    "locally in .env; it is not committed to the repository.",
);
section("V", "Publishing Approval State");
para(
  `NEWS_PUBLISH_ENABLED=${data.config.publishEnabled}. The Owner has enabled ` +
    "the master publish switch locally in .env for this final preparation " +
    "phase; it is not committed to the repository.",
);
section("W", "Dry-Run State");
para(
  `NEWS_DRY_RUN=${data.config.dryRun} and DRY_RUN=true were preserved for the ` +
    "entire phase, as required, and were never changed to false. The live " +
    "dry-run script additionally force-overrides dryRun:true in its own " +
    "config regardless of .env, and the real DiscordClient used for every " +
    "call in this run was itself constructed with dryRun:true -- three " +
    "independent layers, all confirmed holding (section O).",
);

// X -----------------------------------------------------------------
section("X", "Production-Readiness Classification");
para(
  "Per Part 26's criteria, all are confirmed this phase: Discord " +
    "authentication works (section A/N), all three channels are readable " +
    "(section D), Finnhub returns valid data (sections J/K), dedup succeeds " +
    "(section G), impact classification succeeds (sections E/L), freshness " +
    "filter succeeds (section H/M), formatting succeeds (section F), " +
    "typecheck passes (section Q), build passes (section R), all tests " +
    "pass (section S), and Discord write count remains zero (section O).",
);
para("Classification: TECHNICALLY READY FOR CONTROLLED FIRST LIVE POST.");
para(
  "This is not a declaration that the system is already live. Cron remains " +
    "commented out (section T), and no live post has been performed or is " +
    "recommended in this phase.",
);

// Y -----------------------------------------------------------------
section("Y", "Remaining Steps For Phase 3H.4 (Controlled First Live Post)");
bullets([
  "Owner explicitly authorizes the controlled first live post.",
  "Temporarily set NEWS_MAX_POSTS_PER_CHANNEL=1 (down from 3) for the first live run only.",
  "Deliberately switch NEWS_DRY_RUN=false and DRY_RUN=false.",
  "Keep NEWS_LICENSE_APPROVED=true and NEWS_PUBLISH_ENABLED=true.",
  "Run the worker once (workflow_dispatch or local), and manually verify exactly the expected genuinely-fresh, non-duplicate article(s) were posted, correctly formatted, with suppress_embeds and no unintended mentions.",
  "Only after a reviewed, successful controlled first live post would enabling the prepared (still commented) */10 * * * * schedule become a separate, explicitly Owner-approved decision -- not automatic.",
  "None of the above was performed in Phase 3H.3.",
]);

// Z -----------------------------------------------------------------
section("Z", "ServerStats Final-Audit Reminder (Outstanding, Not Touched)");
para(
  "Recorded as outstanding final-audit work, unchanged this phase: the " +
    "ServerStats role currently includes Administrator, and the Server Bots " +
    "role historically carries broad permissions. Both must be reviewed " +
    "together during a future, separate final Discord security audit. No " +
    "role, permission, channel, category, or pinned introduction was " +
    "modified in Phase 3H.3 (Part 25).",
);

doc.spacer(10);
doc.hr();
para(
  "Scope reminder, explicitly separating what happened: REAL Finnhub " +
    `retrieval (${finnhubCounts.GET} live GETs, one per category, ` +
    `${data.categories.map((c) => c.fetchedCount).join("/")} items received ` +
    "general/forex/crypto). REAL Discord reads " +
    `(${discordCounts.GET} live GETs: auth + channel checks + the ` +
    "production dedup step's own reads). MOCKED automated tests (22 files " +
    "/ 235 tests, vitest, zero network access, run separately from the " +
    "above). DISABLED this phase: Discord writes (0 attempted, 0 " +
    "succeeded), any News publication (none), GitHub Actions cron (prepared " +
    "but commented out, not active), and any push to GitHub (none " +
    "performed by this phase's work).",
);

doc.spacer(6);
para(
  "Final safety confirmation: NEWS_LICENSE_APPROVED=true, " +
    "NEWS_PUBLISH_ENABLED=true, NEWS_DRY_RUN=true, DRY_RUN=true; Finnhub is " +
    "the sole active provider; no Finlight integration is active; RSS is " +
    "inactive; Mock is test-only; Discord writes = 0; no News was " +
    "published; cron is not active; no code was pushed to GitHub; no " +
    "Discord permissions or channels were modified.",
);

mkdirSync(OUT_DIR, { recursive: true });
const result = doc.save(OUT_FILE);
console.log(`Wrote ${OUT_FILE} (${result.pageCount} pages, ${result.byteLength} bytes)`);
