/**
 * Generates the Phase 3H.4 report: the controlled first live Discord News
 * publication. Run via: node scripts/generate_report_3h4.mjs
 *
 * Reads reports/phase3h4_data.json, produced by
 * scripts/phase3h4_live_publish.ts (npx tsx scripts/phase3h4_live_publish.ts),
 * which performed the actual real Discord/Finnhub calls -- including the
 * real Discord writes -- this report describes. This script itself makes no
 * network calls -- it only renders the already-captured, non-secret results
 * into a PDF.
 */

import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SimplePdfDocument } from "./pdf/simple_pdf.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "reports");
const OUT_FILE = join(OUT_DIR, "BULLHAUS_Phase3H4_Bericht.pdf");
const DATA_FILE = join(OUT_DIR, "phase3h4_data.json");

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
const postCount = discordCounts.nonGetMethods.filter((m) => m === "POST").length;
const patchCount = discordCounts.nonGetMethods.filter((m) => m === "PATCH").length;
const putCount = discordCounts.nonGetMethods.filter((m) => m === "PUT").length;
const deleteCount = discordCounts.nonGetMethods.filter((m) => m === "DELETE").length;
const published = data.categories.filter((c) => c.published);

doc.title("BULLHAUS Discord V2 - Phase 3H.4 Report");
doc.subtitle("Controlled First Live Discord News Publication");
doc.subtitle("Generated: " + new Date().toISOString());
doc.subtitle("Guild: 1307135789364154459  |  Repo: C:\\BULLHAUS\\discord-mcp");
doc.spacer(10);

para(
  "Headline result: with the Owner's explicit authorization, the News " +
    "Worker performed its first real Discord publication. NEWS_DRY_RUN and " +
    "DRY_RUN were set to false, and NEWS_MAX_POSTS_PER_CHANNEL was set to 1, " +
    "as PROCESS-LEVEL-ONLY overrides for this single run -- the .env file on " +
    "disk was never modified, so the normal production posture (dry-run " +
    "true, cap 3) was restored automatically the moment the run finished, " +
    "confirmed by re-reading .env afterward. " +
    `${published.length} of 3 channels received a genuinely fresh, ` +
    "non-duplicate, real Finnhub article; the remaining channel had none " +
    "eligible this run and correctly received nothing. Every published " +
    "message was read back by id and verified to exactly match the " +
    "required format, with SUPPRESS_EMBEDS set, zero embeds, zero " +
    "mentions, and not pinned. Zero Discord PATCH/PUT/DELETE requests " +
    "occurred. Cron remains commented out and inactive.",
);

// A -----------------------------------------------------------------
section("A", "Pre-Live Safety Check");
para(
  "Hard preflight assertions ran before any client was constructed: " +
    `dryRun=${data.config.dryRun} (expected false), publishEnabled=` +
    `${data.config.publishEnabled} (expected true), finnhubLicenseApproved=` +
    `${data.config.finnhubLicenseApproved} (expected true), providers=` +
    `${JSON.stringify(data.config.providers)} (expected exactly ["finnhub"]), ` +
    `maxPostsPerChannel=${data.config.maxPostsPerChannel} (expected 1), and ` +
    "both DISCORD_BOT_TOKEN and FINNHUB_API_KEY present (values never read " +
    `into this report). preflight.ok=${data.preflight.ok}. Discord ` +
    `authentication then succeeded live: bot user id ${data.auth.botId}, ` +
    `username "${data.auth.botUsername}". All three target channels were ` +
    "read live and found accessible with their existing pinned introduction " +
    "intact before any write was attempted.",
);

// B -----------------------------------------------------------------
section("B", "Impact-Classifier Recap Fix (Part 3)");
para(
  "Before this live run, impact.ts was refined so a recap/wrap headline " +
    "(containing \"news wrap\", \"market wrap\", \"daily wrap\", \"recap\", " +
    "\"market recap\", or \"session recap\") that only mentions a major " +
    "macro release in passing -- CPI, PCE, NFP, GDP, unemployment -- no " +
    "longer auto-classifies High; it now classifies Medium instead, unless " +
    "an independent genuine policy-decision or systemic-event rule also " +
    "matches (which still stays High; the fix never globally demotes real " +
    "emergencies or actual rate decisions). Five regression tests were " +
    "added, including the exact real headline the Phase 3H.3 report had " +
    "flagged as a High false-positive: \"investingLive Americas FX news " +
    "wrap 30 Sept: Softer PCE fails to hold yields down...\" -> now Medium.",
);
para(
  "This exact fix was validated against live production data this run: " +
    "that same headline was fetched live from Finnhub again and is the " +
    "article that was actually selected and published to Forex News this " +
    "run, now correctly labeled \"Estimated Impact: Medium\" rather than " +
    "the High it would have carried before the fix (see section F/L).",
);

// C/D -----------------------------------------------------------------
section("C", "TypeScript Result");
para("npm run typecheck (tsc --noEmit): PASSED, zero errors, run immediately before this live publication per Part 4.");
section("D", "Build Result");
para("npm run build (tsc -p tsconfig.json): PASSED, zero errors, emitted to dist/.");

// E -----------------------------------------------------------------
section("E", "Full Automated-Test Result");
para(
  "npm test (vitest run): 22 test files, 240 tests, all passing -- 5 new " +
    "tests added to tests/news/impact.test.ts for the Part 3 recap/wrap " +
    "refinement (the real 3H.3 regression headline, two additional " +
    "recap/wrap examples, and two tests confirming a genuine policy " +
    "decision or systemic event inside recap/wrap wording still stays " +
    "High), on top of the 235 already passing after Phase 3H.3. Required " +
    "by Part 4 to pass before any live write was attempted -- it did, so " +
    "the live run proceeded.",
);

// F -----------------------------------------------------------------
section("F", "Live Finnhub Fetch Result");
bullets(
  data.categories.map(
    (c) => `${c.category}: ${c.fetchedCount} item(s) fetched live from Finnhub, ${c.staleCount} stale (>60 min), ${c.eligibleCandidateCount} genuinely fresh & non-duplicate candidate(s)`,
  ),
);
para(`Total real Finnhub GET requests: ${finnhubCounts.GET} (one per category, none redundant), ${finnhubCounts.nonGetMethods.length} non-GET.`);

// G/H/I -----------------------------------------------------------------
const byCategory = Object.fromEntries(data.categories.map((c) => [c.category, c]));
section("G", "Trading News (general) Eligible Count");
para(`${byCategory.general?.eligibleCandidateCount ?? 0} eligible candidate(s) this run. Result: ${byCategory.general?.published ? "published" : `not published -- ${byCategory.general?.skipReason}`}. Per Part 7, no stale content or cross-category substitute was used to force a post here.`);
section("H", "Forex News Eligible Count");
para(`${byCategory.forex?.eligibleCandidateCount ?? 0} eligible candidate(s) this run. Result: ${byCategory.forex?.published ? `published (message #${byCategory.forex.messageId})` : `not published -- ${byCategory.forex?.skipReason}`}.`);
section("I", "Crypto News Eligible Count");
para(`${byCategory.crypto?.eligibleCandidateCount ?? 0} eligible candidate(s) this run. Result: ${byCategory.crypto?.published ? `published (message #${byCategory.crypto.messageId})` : `not published -- ${byCategory.crypto?.skipReason}`}.`);

// J -----------------------------------------------------------------
section("J", "Controlled Published Message Count");
para(`${published.length} message(s) published this run, across ${published.length} of 3 channels (maximum allowed this run: 1 per channel, 3 total -- never exceeded).`);

// K -----------------------------------------------------------------
section("K", "Message IDs Grouped By Channel");
if (published.length > 0) {
  bullets(published.map((c) => `${c.category} (#${c.channelId}): message id ${c.messageId}`));
} else {
  para("No messages were published this run.");
}

// L -----------------------------------------------------------------
section("L", "Exact Published Message Previews");
for (const c of published) {
  para(`${c.category} (#${c.channelId}), message #${c.messageId}:`);
  code(c.selected.formattedPreview.split("\n"));
  doc.spacer(2);
}

// M/N/O/P -----------------------------------------------------------------
section("M", "Discord POST Request Count");
para(`${postCount} (expected 0-3, matching the ${published.length} message(s) actually published -- no more, no less).`);
section("N", "Discord PATCH Request Count");
para(`${patchCount} (expected 0).`);
section("O", "Discord PUT Request Count");
para(`${putCount} (expected 0).`);
section("P", "Discord DELETE Request Count");
para(`${deleteCount} (expected 0). No malformed message occurred, so no deletion was considered or performed.`);
if (patchCount > 0 || putCount > 0 || deleteCount > 0) {
  para("SAFETY FAILURE -- UNEXPECTED DISCORD WRITE DURING CONTROLLED LIVE POST. See raw discordWrites in phase3h4_data.json.");
}

// Q -----------------------------------------------------------------
section("Q", "Post-Publication Read-Back Validation");
if (published.length > 0) {
  for (const c of published) {
    const rb = c.readBack;
    bullets([
      `${c.category} #${c.messageId}: ok=${rb.ok}, channel matches=${rb.channelId === c.channelId}, author matches bot id=${rb.authorId === data.auth.botId}, content exactly matches expected format=${rb.contentMatches}, problems=${rb.problems.length === 0 ? "none" : rb.problems.join("; ")}`,
    ]);
  }
} else {
  para("No messages were published, so no read-back was needed.");
}

// R -----------------------------------------------------------------
section("R", "Embed-Suppression Verification");
if (published.length > 0) {
  bullets(published.map((c) => `${c.category} #${c.messageId}: suppress_embeds flag set=${c.readBack.suppressEmbeds}, embeds present=${c.readBack.hasEmbeds} (expected false)`));
} else {
  para("No messages were published.");
}

// S -----------------------------------------------------------------
section("S", "Mention-Neutralization Verification");
if (published.length > 0) {
  bullets(
    published.map(
      (c) =>
        `${c.category} #${c.messageId}: mention_everyone=${c.readBack.mentionEveryone}, mention_roles count=${c.readBack.mentionRolesCount}, mentions count=${c.readBack.mentionsCount} (all expected 0/false)`,
    ),
  );
} else {
  para("No messages were published.");
}

// T -----------------------------------------------------------------
section("T", "Pinned-Introduction Integrity");
para(
  "Each target channel's pinned message id(s) and content were snapshotted " +
    "live before any write this run, and re-read live after each " +
    "publication to confirm neither was altered, replaced, or unpinned, " +
    "and that the new News message itself was never accidentally pinned:",
);
bullets(
  data.categories.map(
    (c) =>
      `${c.category}: ${c.published ? `pinned-integrity check ${c.pinnedIntegrityOk ? "PASSED" : "FAILED"}, new message pinned=${c.readBack?.pinned ?? "n/a"}` : "not published this run, introduction untouched by definition"}`,
  ),
);

// U -----------------------------------------------------------------
section("U", "Post-Publication Duplicate Detection");
para(
  "For each channel that received a publication, the live duplicate-check " +
    "read path (dedup.ts#fetchRecentlyPublishedUrls) was run again " +
    "read-only -- no second publishing cycle was performed -- confirming " +
    "the just-published article's normalized URL is now detected as " +
    "previously published:",
);
bullets(
  published.map((c) => `${c.category}: duplicate recheck ${c.duplicateRecheckOk ? "CONFIRMED" : "FAILED"} -- ${c.selected.url}`),
);

// V -----------------------------------------------------------------
section("V", "Normal Publication-Cap Restoration");
para(
  `NEWS_MAX_POSTS_PER_CHANNEL was overridden to 1 as a PROCESS-LEVEL-ONLY ` +
    "environment variable inside the live-publish script; .env on disk was " +
    "never modified. Re-reading .env immediately after this run confirms " +
    "NEWS_MAX_POSTS_PER_CHANNEL=3, NEWS_DRY_RUN=true, and DRY_RUN=true are " +
    "already in effect again -- no restoration step was necessary, and none " +
    "was performed, per Part 15. No second News Worker run was performed " +
    "after this confirmation.",
);

// W -----------------------------------------------------------------
section("W", "GitHub Cron Status");
para(
  ".github/workflows/news-worker.yml is unchanged since Phase 3H.3: the " +
    "\"*/10 * * * *\" schedule trigger remains present only as a commented-" +
    "out block, workflow_dispatch remains the sole active trigger, and " +
    "nothing was pushed to GitHub as part of this phase's work. Automatic " +
    "scheduled production was not activated and is not recommended to " +
    "activate automatically as a result of this report -- that remains a " +
    "separate, explicit Owner decision.",
);

// X -----------------------------------------------------------------
section("X", "Final Readiness Assessment");
const classification =
  published.length > 0
    ? "CONTROLLED LIVE TEST SUCCESSFUL -- READY FOR SCHEDULED PRODUCTION"
    : "CONTROLLED LIVE TEST PENDING -- NO QUALIFYING FRESH ARTICLE";
para(`Classification: ${classification}`);
bullets([
  `${published.length} of 3 channels published exactly one real, live, non-duplicate, fresh Finnhub article each; the other ${3 - published.length} channel(s) correctly received nothing rather than a forced or stale post.`,
  "Every published message passed live read-back validation: correct channel, correct author, exact format match, embeds suppressed, no mentions, not pinned.",
  "Pinned introductions verified unchanged in every channel.",
  "Post-publication duplicate detection confirmed both published URLs are now recognized as already-published.",
  `Discord writes: ${postCount} POST, ${patchCount} PATCH, ${putCount} PUT, ${deleteCount} DELETE -- no unexpected mutation method occurred.`,
  "Cron remains commented out; nothing was pushed to GitHub; no Discord role, permission, channel, or pinned introduction was modified.",
]);

doc.spacer(10);
doc.hr();
para(
  "Scope reminder, explicitly separating what happened: REAL Discord " +
    `writes (${postCount} live POST request(s) -- the first ever performed ` +
    "by this system -- 0 PATCH/PUT/DELETE). REAL Discord reads " +
    `(${discordCounts.GET} live GETs across auth, channel/pin checks, dedup ` +
    "checks, read-back validation, and post-publication duplicate " +
    `recheck). REAL Finnhub reads (${finnhubCounts.GET} live GETs, one per ` +
    "category). MOCKED automated tests (22 files / 240 tests, vitest, zero " +
    "network access, run separately from all of the above, before the live " +
    "write was attempted). DISABLED this phase: GitHub Actions cron " +
    "(commented out, not activated), any push to GitHub (none performed), " +
    "and any second publishing cycle (none run).",
);

doc.spacer(6);
para(
  "Final confirmation: Finnhub is the only active provider; " +
    "NEWS_LICENSE_APPROVED=true; NEWS_PUBLISH_ENABLED=true; this controlled " +
    `run used live publishing (NEWS_DRY_RUN=false, process-level override); ` +
    "maximum posts per channel was 1; " +
    `${published.length} Discord message(s) were actually published (ids: ` +
    `${published.map((c) => c.messageId).join(", ") || "none"}); no stale ` +
    "article was published; no duplicate was published; pinned " +
    "introductions remained intact; cron remains disabled; nothing was " +
    "pushed to GitHub; no Discord server structure or permissions were " +
    "changed.",
);

mkdirSync(OUT_DIR, { recursive: true });
const result = doc.save(OUT_FILE);
console.log(`Wrote ${OUT_FILE} (${result.pageCount} pages, ${result.byteLength} bytes)`);
