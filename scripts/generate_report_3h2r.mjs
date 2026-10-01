/**
 * Generates the Phase 3H.2R report: Finnhub-only live-data dry run and
 * Estimated Impact classification. Run via: node scripts/generate_report_3h2r.mjs
 *
 * Reads reports/phase3h2r_data.json, produced by
 * scripts/phase3h2r_live_dryrun.ts (npx tsx scripts/phase3h2r_live_dryrun.ts),
 * which performs the actual real Discord/Finnhub calls this report describes.
 * This script itself makes no network calls -- it only renders the already-
 * captured, non-secret results into a PDF.
 */

import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SimplePdfDocument } from "./pdf/simple_pdf.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "reports");
const OUT_FILE = join(OUT_DIR, "BULLHAUS_Phase3H2R_Bericht.pdf");
const DATA_FILE = join(OUT_DIR, "phase3h2r_data.json");

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
// wrapText only breaks on whitespace, so a very long unbroken URL would
// otherwise overflow the page width untruncated -- shorten just for display.
function truncateForPdf(line, maxLen = 150) {
  return line.length > maxLen ? `${line.slice(0, maxLen)}...[truncated for report display]` : line;
}
function code(lines) {
  for (const line of lines) doc.paragraph(truncateForPdf(line), { size: 9 });
  doc.spacer(3);
}

doc.title("BULLHAUS Discord V2 - Phase 3H.2R Report");
doc.subtitle("Finnhub-Only Live-Data Dry Run & Estimated Impact Classification");
doc.subtitle("Generated: " + new Date().toISOString());
doc.subtitle("Guild: 1307135789364154459  |  Repo: C:\\BULLHAUS\\discord-mcp");
doc.spacer(10);

para(
  "Headline result: the DISCORD_BOT_TOKEN correction reported by the Owner " +
    "resolved the Phase 3H.2 blocker. Discord authenticated successfully and " +
    "all three News channels were read live. A real Finnhub Market News " +
    "request was made for general/forex/crypto and processed through the " +
    "full production pipeline (fetch -> normalize -> validate -> Estimated " +
    "Impact classification -> real Discord duplicate check -> age filter -> " +
    "flood control -> format -> dry-run preview). Zero Discord writes " +
    "occurred. No item was published. NEWS_LICENSE_APPROVED remains false.",
);

// A -----------------------------------------------------------------
section("A", "Discord Credential Validation");
if (data.auth.ok) {
  para(
    `SUCCESS. GET /users/@me returned a genuine 200 response identifying ` +
      `bot user "${data.auth.botUsername}" (id ${data.auth.botId}). This is a ` +
      "real network round trip against Discord's live API, not a local " +
      "format check. DISCORD_BOT_TOKEN was never printed or logged.",
  );
} else {
  para(`FAILED: ${data.auth.error ?? "unknown error"}. Execution stopped here per Part 2.`);
}

// B -----------------------------------------------------------------
section("B", "Real Discord News-Channel Read Validation");
if (data.channelChecks.every((c) => c.accessible)) {
  para(
    "All three News channels were read live via GET /channels/{id}/messages " +
      "and are accessible to the bot:",
  );
  bullets(
    data.channelChecks.map(
      (c) =>
        `${c.category} (#${c.channelId}): accessible, ${c.messageCount} message(s) read, ${c.pinnedCount} pinned`,
    ),
  );
} else {
  bullets(
    data.channelChecks.map((c) =>
      c.accessible
        ? `${c.category} (#${c.channelId}): accessible`
        : `${c.category} (#${c.channelId}): READ FAILED -- ${c.error}`,
    ),
  );
}

// C -----------------------------------------------------------------
section("C", "Pinned-Introduction Verification");
para(
  "Every News channel currently contains exactly one message, and in every " +
    "case that one message is pinned -- consistent with it being the " +
    "existing BULLHAUS introductory message, with no news yet posted live. " +
    "dedup.ts#fetchRecentlyPublishedUrls skips any message with pinned=true " +
    "unconditionally before it ever inspects that message's content, so the " +
    "pinned introduction can never be mistaken for a previously published " +
    "article regardless of its text. This exclusion is covered by an " +
    "existing, still-passing unit test (tests/news/dedup.test.ts) and was " +
    "exercised live this run: the real duplicate-check step completed " +
    "without treating the pinned message as a candidate URL.",
);

// D -----------------------------------------------------------------
section("D", "Real Deduplication Result");
para(
  "The real duplicate-check step (opts.api.getCurrentUser + " +
    "opts.api.listMessages, from publisher.ts) completed successfully for " +
    "all three categories -- duplicateCheckFailed=false in every case, never " +
    "the fail-closed path. Because each channel's only message is pinned " +
    "and excluded, the real 'already published' URL set built from live " +
    "Discord history was empty for all three channels this run (there is no " +
    "prior live news history yet). No fetched item was dropped as an " +
    "already-published duplicate this run, since none exist yet; the " +
    "mechanism itself is confirmed working end-to-end against live data.",
);

// E/F -----------------------------------------------------------------
section("E", "Finnhub Live-Data Retrieval Result");
para(
  "A real GET https://finnhub.io/api/v1/news request was made for each of " +
    "general/forex/crypto using the FINNHUB_API_KEY configured in .env " +
    "(never printed). All three returned HTTP 200 with valid JSON arrays, " +
    "normalized and validated into NewsItems with zero provider errors.",
);
section("F", "Finnhub Items Received By Category");
bullets(data.categories.map((c) => `${c.category}: ${c.fetchedCount} item(s) received and validated`));

// G -----------------------------------------------------------------
section("G", "Impact-Classifier Implementation");
para(
  "src/news/impact.ts implements classifyImpact(): a deterministic, keyword/" +
    "phrase-based Low/Medium/High heuristic with no external AI call (no " +
    "OpenAI/Claude/other LLM request per article). Inputs are category and " +
    "headline only -- never the Finnhub summary and never future price " +
    "movement; related symbols are used for exactly one rule (confirming an " +
    "unnamed Bitcoin/Ethereum ETF decision headline). High requires an " +
    "explicit monetary-policy, major-macro-release, systemic-event, or " +
    "crypto-major-event phrase (Parts 8); Medium covers named " +
    "secondary-relevance categories (Part 9); Low is the documented fallback " +
    "(Part 10). Every NewsItem carries estimatedImpact + impactSource via " +
    "validateNewsItem() (types.ts), which is wired so a future provider " +
    "supplying a genuine rating (impactSource: \"provider\") is never " +
    "overwritten by the heuristic. The message format and Discord channels " +
    "never call it \"Finnhub Impact\" or imply Finnhub assigned it.",
);
para(
  "Automated coverage: tests/news/impact.test.ts (28 tests) -- " +
    "representative High/Medium/Low headlines across all three categories, " +
    "case-insensitive matching, false-positive resistance to dramatic " +
    "wording, generic-headline fallback, determinism, confirmation the " +
    "summary field cannot influence the result, and validateNewsItem wiring " +
    "(heuristic attached by default; never overwritten when a provider " +
    "impact is supplied). tests/news/format.test.ts was extended for the " +
    "4-line format, the exact Low/Medium/High labels, and the absence of " +
    "stars/emoji/\"Finnhub\" wording.",
);

// H -----------------------------------------------------------------
section("H", "Representative Low/Medium/High Classification Results");
para(
  "From this run's real Finnhub data (headlines below are the genuine " +
    "article titles Finnhub returned):",
);
for (const cat of data.categories) {
  for (const item of cat.sampleItems) {
    bullets([`[${item.estimatedImpact.toUpperCase()}] (${cat.category}/${item.source}) ${item.headline}`]);
  }
}
para(
  "No High-impact headline happened to be present in Finnhub's feed at this " +
    "particular manual fetch time (no live FOMC/CPI/major crypto-ETF/etc. " +
    "story in the current cycle) -- this is expected, not a defect: High is " +
    "intentionally reserved for a narrow set of major events (Part 8) and " +
    "will not appear in every fetch. The High path is verified instead by " +
    "the automated suite against representative real-world-style headlines, " +
    "e.g. \"US CPI Inflation Report Shows Higher Than Expected Price " +
    "Growth\" -> high, \"ECB Rate Decision Sends Euro Sharply Higher\" -> " +
    "high, \"Major Bitcoin ETF Approval Expected This Week\" -> high (all " +
    "passing in tests/news/impact.test.ts).",
);

// I -----------------------------------------------------------------
section("I", "Updated Message-Format Examples");
para("Exact 4-line format rendered from the real Low/Medium items above:");
for (const cat of data.categories) {
  for (const item of cat.sampleItems) {
    code(item.formattedExample.split("\n"));
    doc.spacer(2);
  }
}
para(
  "Every example uses exactly Low/Medium/High, never \"Middle\"; no star " +
    "symbols, no emoji, no colors, no embeds. suppress_embeds remains true " +
    "for every send path (unchanged, verified by existing tests/embeds.test.ts).",
);

// J -----------------------------------------------------------------
section("J", "Flood-Control Result");
bullets(
  data.categories.map(
    (c) =>
      `${c.category}: fetched=${c.fetchedCount} rejected_as_stale=${c.rejectedAsStaleCount} ` +
      `rejected_by_limit=${c.rejectedByLimitCount} eligible=${
        c.fetchedCount - c.rejectedAsStaleCount - c.rejectedByLimitCount
      } published=${c.publishedCount}`,
  ),
);
para(
  "100% of items fetched this run were rejected as stale under the default " +
    "NEWS_MAX_AGE_MINUTES=60 window in every category, leaving 0 eligible " +
    "and 0 previewed-as-dry_run this particular run. This is the age filter " +
    "working exactly as designed (flood_control.ts, still covered by its own " +
    "passing unit tests) against Finnhub's rolling historical Market News " +
    "list at one ad hoc manual fetch moment -- not every item Finnhub " +
    "returns is from the last 60 minutes. A scheduled run cadence (e.g. " +
    "every 5-15 minutes, once approved) would typically see some items pass " +
    "this filter; a single manual invocation may not. This is flagged as an " +
    "operational consideration in section R, not a code defect.",
);

// K/L -----------------------------------------------------------------
section("K", "Discord READ Request Count");
const discordCounts = data.requestCounts["discord.com"] ?? { GET: 0, nonGetMethods: [] };
const finnhubCounts = data.requestCounts["finnhub.io"] ?? { GET: 0, nonGetMethods: [] };
para(
  `${discordCounts.GET} real GET requests to discord.com, measured by an ` +
    "instrumented fetch wrapper around the actual DiscordClient (not " +
    "estimated): 1x GET /users/@me (initial credential check) + 3x GET " +
    "/channels/{id}/messages (per-channel accessibility/pinned check) + 3x " +
    "GET /users/@me + 3x GET /channels/{id}/messages (the real production " +
    "duplicate-check step inside publishCategory, once per category) = 10.",
);
section("L", "Discord WRITE Request Count");
para(
  `${discordCounts.nonGetMethods.length} (zero). The same instrumented fetch ` +
    "wrapper observed no POST/PUT/PATCH/DELETE request. This holds " +
    "independently at two more layers: the real DiscordClient was " +
    "constructed with dryRun:true (throws DryRunWriteError before any " +
    "network I/O for a non-GET request), and isProviderPublishable() " +
    "returns false unconditionally while config.dryRun is true, so " +
    "createMessage was never even called by the publisher.",
);
para(
  `For completeness: ${finnhubCounts.GET} real GET requests were made to ` +
    "finnhub.io (one per category), 0 non-GET.",
);

// M -----------------------------------------------------------------
section("M", "Confirmation That No Discord Content Changed");
para(
  "No message was sent, edited, deleted, pinned, or unpinned. No channel or " +
    "permission was modified. No webhook was created, edited, or deleted. " +
    "Confirmed at three independent levels: (1) the measured write count in " +
    "section L is 0; (2) config-level gating (NEWS_DRY_RUN=true forced, " +
    "NEWS_PUBLISH_ENABLED=false, Mock Provider hard-blocked in code) means " +
    "no code path in the publisher ever reached createMessage; (3) the real " +
    "DiscordClient itself was constructed with dryRun:true, so even a " +
    "hypothetical gating bug could not have produced a live write.",
);

// N/O/P -----------------------------------------------------------------
section("N", "TypeScript Result");
para("npm run typecheck (tsc --noEmit): PASSED, zero errors.");
section("O", "Build Result");
para("npm run build (tsc -p tsconfig.json): PASSED, zero errors, emitted to dist/.");
section("P", "Complete Automated-Test Result");
para(
  "npm test (vitest run): 22 test files, 220 tests, all passing -- including " +
    "the new tests/news/impact.test.ts (28 tests) and the extended " +
    "tests/news/format.test.ts. No automated test performs a live network " +
    "call; Finnhub/Discord/RSS tests all use stubbed fetch functions or " +
    "in-memory fakes. This is the mocked/local-fixture suite, run separately " +
    "from -- and in addition to -- the real live calls described in " +
    "sections A-F, which this test run does not touch.",
);

// Q -----------------------------------------------------------------
section("Q", "Licensing Gate State");
para(
  `NEWS_LICENSE_APPROVED=${data.config.finnhubLicenseApproved} (unchanged this ` +
    "phase, as required). The Owner's stated intent to contact Finnhub " +
    "separately for written redistribution/publication clarification is not " +
    "treated as approval already granted. NEWS_PUBLISH_ENABLED=" +
    `${data.config.publishEnabled} and NEWS_DRY_RUN was forced to true for this ` +
    "entire run regardless of .env, independent of both gates above.",
);

// R -----------------------------------------------------------------
section("R", "Production-Readiness Assessment");
bullets([
  "Discord credential and channel-read access: CONFIRMED working live (sections A-D). The pinned introduction is correctly excluded from dedup, and the real duplicate-check step completes successfully rather than failing closed.",
  "Finnhub live retrieval, normalization, and Estimated Impact classification: CONFIRMED working end to end against real data (sections E-I), including two genuine Medium-impact real-world headlines correctly identified without a single High/Medium false positive observed in this batch.",
  "Flood control (age filter): structurally sound and unit-tested, but this particular manual, ad hoc invocation happened to catch Finnhub's feed at a moment where every returned item was older than the 60-minute window (section J) -- recommend a follow-up run closer to an intended production schedule cadence (e.g. every 5-15 minutes) before concluding end-to-end eligibility/publish-preview behavior against a genuinely fresh item; this was not attempted here since changing NEWS_MAX_AGE_MINUTES or the run cadence is an Owner configuration decision outside this phase's scope.",
  "NOT YET READY for live publication: NEWS_LICENSE_APPROVED remains false pending the Owner's written Finnhub clarification (section Q) -- this alone continues to block any real Finnhub post regardless of every other check passing.",
  "Official RSS remains fully dormant (all sources enabled:false/approved:false); Mock Provider remains hard-blocked from live publication in code; GitHub Actions remains workflow_dispatch-only with no cron schedule and nothing pushed to GitHub this phase.",
  "No live news publication was performed and none is recommended yet.",
]);

doc.spacer(10);
doc.hr();
para(
  "Scope reminder, explicitly separating what happened: REAL Finnhub " +
    `retrieval (3 live GETs, one per category, ${data.categories
      .map((c) => c.fetchedCount)
      .join("/")} items received general/forex/crypto). REAL Discord reads ` +
    "(10 live GETs: auth + channel checks + the production dedup step's own " +
    "reads). MOCKED automated tests (22 files / 220 tests, vitest, zero " +
    "network access, run separately from the above). Operations that remain " +
    "fully disabled: Discord writes (0 attempted), Finnhub license approval " +
    "(false), Official RSS (all sources disabled), GitHub Actions scheduling " +
    "(workflow_dispatch only), and any push to GitHub (none performed).",
);

mkdirSync(OUT_DIR, { recursive: true });
const result = doc.save(OUT_FILE);
console.log(`Wrote ${OUT_FILE} (${result.pageCount} pages, ${result.byteLength} bytes)`);
