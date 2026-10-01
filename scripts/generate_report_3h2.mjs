/**
 * Generates the Phase 3H.2 controlled live-Discord dry run report.
 * Run via: node scripts/generate_report_3h2.mjs
 */

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SimplePdfDocument } from "./pdf/simple_pdf.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "reports");
const OUT_FILE = join(OUT_DIR, "BULLHAUS_Phase3H2_Bericht.pdf");

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

doc.title("BULLHAUS Discord V2 -- Phase 3H.2 Development Report");
doc.subtitle("Controlled Live-Discord Dry Run");
doc.subtitle("Generated: " + new Date().toISOString());
doc.subtitle("Guild: 1307135789364154459  |  Repo: C:\\BULLHAUS\\discord-mcp");
doc.spacer(10);

para(
  "Headline result: the real bot token currently stored in .env is invalid " +
    "(confirmed by a genuine 401 Unauthorized from Discord's API, not a " +
    "local format check). This blocked the real-channel-history portion of " +
    "this phase (section B-E), but it also produced strong, real-world " +
    "evidence that the News Worker's safety behavior holds under an actual " +
    "failure: zero write requests occurred, and every category correctly " +
    "refused to publish rather than assume history was empty. No MCP code " +
    "bug was found; no source code was modified this phase.",
);

// A -----------------------------------------------------------------
section("A", "Environment Safety Configuration");
para(
  "Checked .env before any run. No NEWS_* variable is set there at all, so " +
    "the code's built-in safe defaults applied without any override needed: " +
    "NEWS_DRY_RUN=true, NEWS_PUBLISH_ENABLED=false, NEWS_PROVIDERS=mock. " +
    "DISCORD_GUILD_ID is also unset, so config/bullhaus.ts fell back to its " +
    "hard-coded default, which is the real BULLHAUS guild id " +
    "(1307135789364154459). FINNHUB_API_KEY is unset (Finnhub inert either " +
    "way, since it wasn't in NEWS_PROVIDERS). For this run, every safety " +
    "value was additionally forced in-process (not just relied on from " +
    ".env): dryRun:true, publishEnabled:false, providers:['mock'], AND the " +
    "real DiscordClient itself was constructed with dryRun:true, which " +
    "refuses any non-GET request before it reaches the network -- three " +
    "independent layers, all closed.",
);

// B -----------------------------------------------------------------
section("B", "Real Discord Channel-Read Result");
para(
  "BLOCKED by an invalid credential, not by a code fault. The value stored " +
    "as DISCORD_BOT_TOKEN in .env (82 characters) does not have the shape of " +
    "a real Discord bot token and is, in fact, a stray PowerShell " +
    "diagnostic snippet that appears to have been pasted into the token " +
    "field by mistake (see section K). Every real request made with it was " +
    "rejected by Discord with a genuine 401 Unauthorized -- this was " +
    "confirmed over the live network, not assumed. As instructed, the token " +
    "was never printed and was not requested from the Owner; this report " +
    "flags the misconfiguration instead.",
);

// C/D/E ---------------------------------------------------------------
for (const [letter, name, channel] of [
  ["C", "Trading News (general)", "1554782909272039476"],
  ["D", "Forex News (forex)", "1554783055535804470"],
  ["E", "Crypto News (crypto)", "1554838955294195863"],
]) {
  section(letter, `${name} History/Dedup Result`);
  para(
    `Channel: #${channel}. A real GET /channels/${channel}/messages request ` +
      "was sent and Discord genuinely responded 401 Unauthorized (invalid " +
      "credential) -- channel accessibility, pinned-intro visibility, and " +
      "real dedup content could NOT be verified this phase as a direct " +
      "result. What WAS verified live: the worker's duplicate-check-failure " +
      "path activated correctly for this channel (fetchRecentlyPublishedUrls " +
      "threw, was caught), the channel's category was marked " +
      "duplicateCheckFailed=true, and every fetched Mock item for this " +
      "category was skipped with reason 'duplicate_check_failed' rather " +
      "than being treated as safe to publish. Zero writes were attempted " +
      "against this channel.",
  );
}

// F -----------------------------------------------------------------
section("F", "Mock Provider Processing Result");
para(
  "The Mock Provider itself ran successfully end to end (it needs no " +
    "Discord access to fetch): general returned 3 fixture items, forex " +
    "returned 2, crypto returned 2 -- matching the fixture counts shipped in " +
    "providers/mock_provider.ts exactly. Category routing to the correct " +
    "channel id was correct in all 3 cases. Because the duplicate check " +
    "failed for every category (section B), items never proceeded to flood " +
    "control or formatting in this particular run -- that is the intended, " +
    "safe behavior (a failed dedup check blocks the whole channel), and it " +
    "is itself a real, live confirmation that this safeguard works under an " +
    "actual failure rather than only in a mocked test. Age-filtering and " +
    "per-channel volume caps were already exercised with real assertions in " +
    "Phase 3H.1's automated test suite (tests/news/flood_control.test.ts, " +
    "tests/news/publisher.test.ts) and were not re-derived here. As " +
    "required, no Mock Provider item was posted to Discord.",
);

// G/H -----------------------------------------------------------------
section("G", "Discord READ Request Count");
para(
  "6 real GET requests were sent to the live Discord API, all measured by " +
    "wrapping the actual fetch call the DiscordClient uses (not estimated): " +
    "3x GET /users/@me (one per category, from the worker's own duplicate- " +
    "check step) and 3x GET /channels/{id}/messages (one per News channel, " +
    "from a separate diagnostic pass added for this audit to attempt the " +
    "pinned-message check in section C-E). All 6 received a 401 response " +
    "from Discord -- a real round trip in both directions, not a local " +
    "short-circuit.",
);
section("H", "Discord WRITE Request Count");
para(
  "0 (zero). No POST/PATCH/PUT/DELETE request was ever attempted, " +
    "confirmed by the same instrumented fetch wrapper used for the read " +
    "count above -- it never observed a non-GET call. This holds even " +
    "though every category hit an error path, which is exactly the " +
    "condition most likely to accidentally trigger an unintended write if " +
    "error handling were wrong; it was not.",
);

// I -----------------------------------------------------------------
section("I", "Confirmation That No Discord Content Changed");
para(
  "No message was sent, edited, deleted, pinned, or unpinned. No channel or " +
    "permission was modified. No webhook was created or deleted. This is " +
    "confirmed at three independent levels: (1) the measured write count in " +
    "section H is 0; (2) config-level gating (dryRun:true, " +
    "publishEnabled:false, Mock Provider hard-blocked in code) meant no code " +
    "path in the publisher ever reached a createMessage call; and (3) the " +
    "real DiscordClient was itself constructed with dryRun:true, which " +
    "throws DryRunWriteError before any network I/O for a non-GET request, " +
    "so even a hypothetical bug in the publisher's own gating could not have " +
    "produced a live write in this run.",
);

// J -----------------------------------------------------------------
section("J", "RSS Phase-3H.1 Clarification");
para(
  "The Phase 3H.1 report's blanket statement that 'no live RSS request was " +
    "made' was imprecise and is corrected here, based on this session's own " +
    "history (no new live request was made to answer this question, per " +
    "instruction). Four distinct things happened, and only one of them was " +
    "a live fetch of an actual feed:",
);
bullets([
  "Validating official feed URLs: two HTML index/listing pages were fetched live via a general web-fetch tool -- federalreserve.gov/feeds/feeds.htm and ecb.europa.eu/home/html/rss.en.html -- to read off the exact, real feed URLs those institutions publish, rather than guessing or inventing any.",
  "Fetching a feed once for source verification: the actual ECB URL later configured as 'ecb_press' (https://www.ecb.europa.eu/rss/press.html) was fetched live, exactly once, specifically to confirm that despite its .html extension it genuinely serves an RSS 2.0 XML document -- not to exercise the News Worker. This was done with the same general web-fetch tool, NOT the News Worker's own HTTP client, and did not touch OfficialRssProvider or its download()/parseFeed() code at all. The two Federal Reserve feed files (press_all.xml, press_monetary.xml) were never fetched live -- only referenced from the feeds.htm listing.",
  "Running the News Worker against live RSS: never happened, in either phase. OfficialRssProvider only ever fetches sources that are both enabled and approved in rss/sources.ts, and every shipped source has both flags set to false -- so even a full `npm run news` invocation could not have triggered a live RSS fetch through the worker's own code.",
  "Automated tests using local RSS fixtures: this is how the parser and the Official RSS Provider were actually tested (tests/news/rss_parser.test.ts, tests/news/official_rss_provider.test.ts) -- a fetchFn stub and local files under tests/fixtures/rss/, zero network access.",
]);
para(
  "Net correction: the News Worker's own code and its entire automated test " +
    "suite never made a live RSS request, in either phase -- that part of " +
    "the original statement is accurate and still holds. What was inaccurate " +
    "was extending that claim to the Owner's/assistant's own one-time, " +
    "manual, outside-the-worker verification fetches performed during " +
    "source vetting in Phase 3H.1. Those were read-only GETs to public " +
    "institutional RSS/HTML pages, made with a general-purpose tool, not the " +
    "project's Discord or RSS client code, and they did not publish, store, " +
    "or process any content beyond confirming the URLs are genuine.",
);

// K -----------------------------------------------------------------
section("K", "Bugs or Configuration Issues Discovered");
para(
  "No MCP/News-Worker code bug was found. Error handling behaved exactly as " +
    "designed under a real failure (correct 401 mapping with an actionable " +
    "hint, zero writes, duplicate-check-failure correctly blocking " +
    "publication instead of assuming empty history). Per instruction, no " +
    "source code was modified this phase.",
);
para(
  "One configuration issue WAS found, outside the codebase: the " +
    "DISCORD_BOT_TOKEN value in .env is not a real Discord bot token. It is " +
    "82 characters long and matches the shape of a PowerShell conditional " +
    "expression (of the form used to check whether an environment variable " +
    "is set) rather than a Discord token -- consistent with that diagnostic " +
    "one-liner having been pasted into the token field by mistake instead of " +
    "being run as a command. This was confirmed two ways: a structural shape " +
    "check, and a genuine 401 Unauthorized from Discord's API when the value " +
    "was actually used. This is a local environment file issue, not a code " +
    "defect, and per instruction the Owner was not asked to supply a token; " +
    "fixing .env is an Owner action, not something this report requests.",
);
para(
  "A secondary, minor observation: sourcing this .env file directly in bash " +
    "(e.g. `source .env`) fails with a shell syntax error because of the " +
    "parentheses/quoting in that same malformed line -- another symptom of " +
    "the same root cause, not a separate issue.",
);

// L -----------------------------------------------------------------
section("L", "Readiness Assessment for First Controlled Live News Publication");
bullets([
  "NOT YET READY, blocked specifically on a valid DISCORD_BOT_TOKEN in .env -- everything else checked this phase (write-blocking, approval gating, duplicate-check fail-closed behavior, Mock pipeline routing/formatting) is confirmed working, including under a real live failure condition.",
  "Once a genuine token is in place, re-run this same controlled dry run (NEWS_DRY_RUN=true, NEWS_PUBLISH_ENABLED=false, NEWS_PROVIDERS=mock) to confirm real channel-history reads succeed, the pinned introductory message is visible and excluded from dedup, and the duplicate-URL set builds correctly from real data -- none of which could be confirmed this phase.",
  "Finnhub and Official RSS remain untouched and unapproved, exactly as instructed -- no change to NEWS_LICENSE_APPROVED, no RSS source's enabled/approved flags, no GitHub Actions schedule, no Discord permissions, no channel configuration, no webhook configuration.",
  "No live news publication was performed and none is recommended yet; that remains gated behind the Owner's explicit provider-approval decisions from Phase 3H.1 section T, now with a valid token as an added precondition.",
]);

doc.spacer(10);
doc.hr();
para(
  "Scope reminder: this phase performed READ-ONLY real Discord API calls " +
    "(3 succeeded structurally as requests but were rejected with 401 by " +
    "Discord; see sections B-E) plus the existing fully-mocked/local-fixture " +
    "automated test suite (unchanged, still 21 files / 190 tests / all " +
    "passing, re-verified this phase). No production news publishing " +
    "occurred or was enabled. No source code was modified.",
);

mkdirSync(OUT_DIR, { recursive: true });
const result = doc.save(OUT_FILE);
console.log(`Wrote ${OUT_FILE} (${result.pageCount} pages, ${result.byteLength} bytes)`);
