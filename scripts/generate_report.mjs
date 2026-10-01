/**
 * Generates the Phase 3H.1 development report as a PDF, using the built-in
 * SimplePdfDocument writer (no external PDF dependency). Run via:
 *   node scripts/generate_report.mjs
 */

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SimplePdfDocument } from "./pdf/simple_pdf.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "reports");
const OUT_FILE = join(OUT_DIR, "BULLHAUS_Phase3H1_Bericht.pdf");

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

// ---------------------------------------------------------------------------
doc.title("BULLHAUS Discord V2 -- Phase 3H.1 Development Report");
doc.subtitle("MCP Extensions & News Infrastructure");
doc.subtitle("Generated: " + new Date().toISOString());
doc.subtitle("Guild: 1307135789364154459  |  Repo: C:\\BULLHAUS\\discord-mcp");
doc.spacer(10);

para(
  "Scope note: this phase covers development and local testing only. No live " +
    "Discord messages were sent, no real webhooks were created or deleted, no " +
    "live Finnhub or RSS requests were made, no Discord roles/permissions were " +
    "changed, and no code was pushed to GitHub. Everything below marked " +
    "'tested' was tested against mocks/fakes/local fixtures, never a live " +
    "external service.",
);

// A ---------------------------------------------------------------------
section("A", "Repository Inspection");
para(
  "Existing project: discord-provisioner-mcp v0.2.0, TypeScript (strict, " +
    "NodeNext), MCP SDK server with stdio and Streamable HTTP transports, a " +
    "hand-rolled Discord REST client with route-bucket rate limiting and " +
    "DRY_RUN enforcement at the HTTP layer, 22 existing MCP tools, and a " +
    "vitest suite running entirely against in-memory fakes (no network calls " +
    "in tests). Existing conventions -- allow-listed sanitized output " +
    "(publicRole/publicChannel/publicMessage), confirm-gated destructive " +
    "tools, structured MCP error results instead of thrown exceptions, and " +
    "BigInt-based permission bitfields -- were followed throughout this " +
    "phase rather than introducing new patterns.",
);

// B ---------------------------------------------------------------------
section("B", "Files Created and Modified");
para("New source files:");
bullets([
  "src/config/bullhaus.ts -- BULLHAUS_GUILD_ID and the News channel mapping, one place for both.",
  "src/discord/snowflake.ts -- shared snowflake regex/validator.",
  "src/tools/list_webhooks.ts, create_webhook.ts, delete_webhook.ts",
  "src/news/ (13 files) -- types, provider interface, config, format, dedup, flood_control, publisher, cli, offline_api, discord_api, providers/{mock,finnhub,official_rss}, rss/{parser,sources}",
  ".github/workflows/news-worker.yml -- workflow_dispatch only, not pushed",
  "scripts/pdf/simple_pdf.mjs, scripts/generate_report.mjs -- this report",
]);
para("Modified source files:");
bullets([
  "src/discord/types.ts -- APIWebhook, WEBHOOK_TYPE, MESSAGE_FLAGS, APIMessage.flags",
  "src/discord/endpoints.ts -- listGuildWebhooks/getWebhook/createWebhook/deleteWebhook, CreateMessagePayload.flags",
  "src/tools/shared.ts -- publicWebhook() sanitizer",
  "src/tools/send_message.ts -- suppress_embeds parameter",
  "src/server.ts -- registers the 3 new webhook tools",
  "package.json -- npm run news / news:dry scripts",
  ".env.example -- DISCORD_GUILD_ID and every NEWS_* variable, documented",
  "README.md -- tool tables, webhook security notes, full News Worker section",
]);
para("Modified/extended test files:");
bullets([
  "tests/helpers.ts -- FakeApi webhook methods, message flags support",
  "tests/server.test.ts, tests/dryrun.test.ts -- extended for the 3 webhook tools and suppress_embeds",
  "New: tests/webhooks.test.ts, tests/embeds.test.ts, tests/news/*.test.ts (11 files)",
]);

// C ---------------------------------------------------------------------
section("C", "New MCP Webhook Tools");
para(
  "list_webhooks(guild_id, channel_id?) -- guild-scoped fetch, optional " +
    "in-memory filter by channel_id, so the guild restriction holds even " +
    "when a channel filter is supplied. Returns id/name/type/guild_id/" +
    "channel_id/application_id/creator_id only.",
);
para(
  "create_webhook(guild_id, channel_id, name, confirm_create, reason?) -- " +
    "rejects any guild other than the configured BULLHAUS guild, verifies " +
    "the channel belongs to that guild via listGuildChannels before " +
    "creating anything, validates the name against Discord's own webhook-name " +
    "rules (length, forbidden characters, 'clyde'/'discord'), and requires " +
    "confirm_create=true.",
);
para(
  "delete_webhook(guild_id, webhook_id, expected_webhook_name, " +
    "expected_channel_id, confirm_delete, reason?) -- fetches the exact " +
    "webhook first and checks guild, name, and channel against the caller's " +
    "expectations; any mismatch aborts without deleting. Requires " +
    "confirm_delete=true. On a network-level failure it re-checks whether " +
    "the webhook still exists (via GET) before ever reporting success, " +
    "instead of blindly retrying a delete that may have already landed.",
);

// D ---------------------------------------------------------------------
section("D", "Webhook Security Safeguards");
bullets([
  "APIWebhook.token / .url (bearer credentials) are never read by publicWebhook() -- an explicit allow-list, not a redaction step.",
  "All three tools are hard-restricted to BULLHAUS_GUILD_ID (src/config/bullhaus.ts); any other guild id is rejected before any Discord call.",
  "create_webhook verifies channel-to-guild membership; delete_webhook re-verifies guild + name + channel identity before deleting.",
  "Both mutating tools require an explicit boolean confirmation field.",
  "No bulk-delete exists; no webhook is ever removed for looking 'inactive'.",
  "Verified in tests: guild restriction, channel validation, name validation, confirm gating, identity-mismatch rejection, a simulated Discord 403 (permission error), a simulated network/timeout error with existence re-check, and that no test assertion ever finds the literal fake token string in tool output.",
]);

// E ---------------------------------------------------------------------
section("E", "Updated send_message Functionality");
para(
  "send_message gained an optional suppress_embeds boolean (default false, " +
    "backward compatible -- omitting it produces byte-identical request " +
    "payloads to before). When true, the message is created with Discord's " +
    "SUPPRESS_EMBEDS flag (bit 2, value 4) via CreateMessagePayload.flags. " +
    "Verified in tests at three levels: the MCP tool result, the FakeApi- " +
    "recorded message object, and the raw JSON body sent to the Discord " +
    "client (flags: 4 present only when requested).",
);

// F ---------------------------------------------------------------------
section("F", "News Worker Architecture");
para(
  "src/news/ implements an independent worker (npm run news / news:dry) " +
    "that does not depend on Claude Desktop or the MCP transport. A shared " +
    "NewsProvider interface (fetchCategory(category)) decouples the worker " +
    "from any one source; NEWS_PROVIDERS selects which are active (comma- " +
    "separated), and multiple can run together without being merged " +
    "automatically. Pipeline per category: fetch (all configured providers, " +
    "one failure never blocks another) -> duplicate check against recent " +
    "Discord channel history -> flood control (age filter, chronological " +
    "sort, per-channel cap) -> per-provider publication-approval gate -> " +
    "format -> (if approved and not dry-run) send with suppress_embeds.",
);

// G ---------------------------------------------------------------------
section("G", "Mock Provider");
para(
  "providers/mock_provider.ts ships fixtures for general/forex/crypto, each " +
    "headline prefixed '[FICTIONAL]' and linking to example.com, with an " +
    "injectable clock so ages are deterministic in tests. It requires no " +
    "credentials and is used for local dry runs, and every provider/format/ " +
    "dedup/flood-control test in this phase. It is hard-blocked in code " +
    "(config.ts: isProviderPublishable) from ever publishing live, " +
    "independent of NEWS_DRY_RUN/NEWS_PUBLISH_ENABLED.",
);

// H ---------------------------------------------------------------------
section("H", "Finnhub Provider");
para(
  "providers/finnhub_provider.ts calls Finnhub's documented Market News " +
    "endpoint (GET /news?category=...&token=...) for general/forex/crypto. " +
    "The API key comes only from FINNHUB_API_KEY (never hard-coded); a " +
    "missing key logs a warning and returns no items rather than throwing. " +
    "Implements a request timeout (AbortController, default 10s), HTTP " +
    "error handling, 429 rate-limit handling, JSON/shape validation, per- " +
    "response id de-duplication, and datetime normalization (Finnhub unix " +
    "seconds -> ISO 8601). Tested exclusively against a mocked fetch " +
    "function -- no live Finnhub request was made. Publication is further " +
    "gated by NEWS_LICENSE_APPROVED (see section J).",
);

// I ---------------------------------------------------------------------
section("I", "Official RSS Provider");
para(
  "providers/official_rss_provider.ts fetches only sources that are BOTH " +
    "enabled and approved in the central rss/sources.ts list -- never an " +
    "unreviewed feed, live or in tests (test overrides still pass through " +
    "the same enabled&&approved filter). Downloads enforce a request " +
    "timeout and a hard response-size cap (checked via Content-Length when " +
    "present, and via a byte-counted streaming read otherwise, aborting the " +
    "read once exceeded). Parsing uses rss/parser.ts, a dependency-free RSS " +
    "2.0 / Atom item extractor that refuses outright to process any document " +
    "containing a DOCTYPE or ENTITY declaration and only ever decodes the " +
    "five predefined XML entities plus numeric character references -- there " +
    "is no general entity-resolution machinery to exploit for XXE or " +
    "billion-laughs style attacks. One source failing never blocks another. " +
    "Only headline, publisher (from the source config, never the feed body), " +
    "UTC time, and the original link are ever produced -- no article body, " +
    "no images.",
);

// J ---------------------------------------------------------------------
section("J", "Proposed Official RSS Sources");
para(
  "Every URL below was verified live against the institution's own site " +
    "before being added (Federal Reserve feeds enumerated from " +
    "federalreserve.gov/feeds/feeds.htm; the ECB feed enumerated from " +
    "ecb.europa.eu/home/html/rss.en.html and confirmed by fetching it -- its " +
    "url ends in .html but the body is a genuine RSS 2.0 document). All " +
    "three ship enabled=false, approved=false; none will be fetched until " +
    "the Owner reviews and flips both flags.",
);
bullets([
  "fed_press_all -- Board of Governors of the Federal Reserve System -- https://www.federalreserve.gov/feeds/press_all.xml -- category: general",
  "fed_press_monetary -- Board of Governors of the Federal Reserve System -- https://www.federalreserve.gov/feeds/press_monetary.xml -- category: forex, keyword-filtered (FOMC, federal funds rate, monetary policy, interest rate)",
  "ecb_press -- European Central Bank -- https://www.ecb.europa.eu/rss/press.html -- category: general",
  "crypto -- no source configured. No verified, appropriately licensed official crypto-regulator RSS feed was identified; none was invented. The Mock Provider covers Crypto News testing until an appropriate source is found and approved.",
]);

// K ---------------------------------------------------------------------
section("K", "Final News Channel Mapping");
bullets([
  "general (Trading News): channel id 1554782909272039476",
  "forex (Forex News): channel id 1554783055535804470",
  "crypto (Crypto News): channel id 1554838955294195863",
]);
para(
  "Defined once in src/config/bullhaus.ts (validated as Discord snowflakes " +
    "at load time) and referenced everywhere else by category name -- no " +
    "channel id is duplicated elsewhere in the codebase. These are the " +
    "Phase 3G.3 channels; no previous/deleted News channel id appears " +
    "anywhere in this codebase.",
);

// L ---------------------------------------------------------------------
section("L", "Duplicate Prevention and Flood Control");
para(
  "Dedup (dedup.ts): before publishing, the worker reads up to " +
    "NEWS_HISTORY_LOOKBACK (default 100) recent messages in the target " +
    "channel, keeps only this bot's own non-pinned messages (the pinned " +
    "introductory message is never treated as news and is never modified), " +
    "and extracts previously-published article links by normalized URL. A " +
    "failed history read does NOT fall back to 'assume nothing was " +
    "published' -- it blocks publication into that channel for the run and " +
    "is reported as duplicate_check_failed. Within-batch duplicates from a " +
    "single provider response are also removed.",
);
para(
  "Flood control (flood_control.ts): items older than NEWS_MAX_AGE_MINUTES " +
    "(default 60) are dropped; survivors are sorted chronologically (oldest " +
    "first) and capped at NEWS_MAX_POSTS_PER_CHANNEL (default 3) per " +
    "category per run, so a provider backlog is throttled rather than " +
    "flooding a channel in one pass.",
);

// M ---------------------------------------------------------------------
section("M", "Dry-Run Results");
para(
  "npm run news:dry (fully offline -- no Discord token, no Finnhub key, " +
    "Mock Provider only) was executed during this phase. Result: 7 mock " +
    "fixture items fetched across the 3 categories, flood control correctly " +
    "dropped 1 stale item per category (age > 60 min) and formatted the " +
    "rest, and every single item was reported SKIPPED with reason " +
    "'dry_run' -- zero Discord API calls were made, confirmed by running " +
    "against an offline stand-in that throws if createMessage is ever " +
    "invoked. Formatted previews matched the required layout exactly: bold " +
    "headline line, 'Publisher (middot) HH:MM UTC' line, then a markdown " +
    "link line.",
);

// N ---------------------------------------------------------------------
section("N", "GitHub Actions Preparation");
para(
  ".github/workflows/news-worker.yml is prepared but not pushed to GitHub " +
    "and not scheduled. Trigger: workflow_dispatch only (an optional " +
    "'providers' input, default 'mock'); no cron. permissions: contents: " +
    "read only. A concurrency group prevents overlapping runs. Steps: " +
    "checkout, actions/setup-node@v4 (Node 20, npm cache), npm ci, npm run " +
    "build, then npm run news:dry with NEWS_DRY_RUN=true and " +
    "NEWS_PUBLISH_ENABLED=false set explicitly in the job (not sourced from " +
    "secrets). Commented-out secrets. references show where a real " +
    "DISCORD_BOT_TOKEN / FINNHUB_API_KEY would go for a future, explicitly " +
    "authorized production run -- none are wired up now.",
);

// O ---------------------------------------------------------------------
section("O", "Credential Security");
bullets([
  "No new bot token, application, or webhook credential was requested or created for real use in this phase.",
  "FINNHUB_API_KEY and DISCORD_BOT_TOKEN are read from process.env only, documented in .env.example, and passed to configureLogging()'s redact list in the News Worker CLI exactly as the existing MCP entrypoint already does for its own secrets.",
  "Webhook tokens/URLs are excluded at the sanitizer boundary (publicWebhook), not merely omitted by convention.",
  "No secret value appears in this report, in source, or in any committed file.",
]);

// P ---------------------------------------------------------------------
section("P", "ServerStats Security Reminder");
para(
  "No live Discord permission change was made this phase (none was in " +
    "scope). Restating the Owner-confirmed finding for the record:",
);
bullets([
  "ServerStats currently carries two roles: the managed 'ServerStats' role (Administrator) and the unmanaged 'Server Bots' role (historically broad permissions). Removing Administrator from ServerStats alone would not meaningfully restrict the bot while Server Bots still grants its own permissions -- both roles must be reviewed and changed together, in one pass.",
  "'Server Bots' is a grouping/display role today but is unmanaged, so nothing stops it from silently accumulating real permissions over time; it should eventually become permission-empty (display-only), with actual access granted per-bot via dedicated managed roles instead.",
  "Because 'Server Bots' is shared, every other bot currently holding it must be identified and confirmed compatible with reduced permissions BEFORE removing anything from that role -- an unrelated bot could silently break.",
  "After any future permission reduction, explicitly re-test that the existing Member and Bot counters (or any feature relying on ServerStats' current access) still function -- do not assume a permission looked unused just because it was broad.",
]);

// Q ---------------------------------------------------------------------
section("Q", "TypeScript and Build Results");
bullets([
  "npm run typecheck: PASS, zero errors (strict mode, noUncheckedIndexedAccess on).",
  "npm run build (tsc -p tsconfig.json): PASS, emitted to dist/ including the new config/ and news/ trees.",
]);

// R ---------------------------------------------------------------------
section("R", "Complete Automated Test Results");
para(
  "npm test (vitest): 21 test files, 190 tests, ALL PASSING. Zero real " +
    "network calls anywhere in the suite (every test runs against an in- " +
    "memory FakeApi, a fetch stub, or local fixture files under " +
    "tests/fixtures/rss/).",
);
bullets([
  "New: tests/webhooks.test.ts (21 tests) -- guild/channel validation, name validation, confirm gating, identity-mismatch rejection, dry-run, a simulated 403 and a simulated network/timeout error with existence re-check, secret-redaction assertions.",
  "New: tests/embeds.test.ts (5 tests) -- normal send, suppress_embeds on/off, dry-run preview, raw JSON payload shape.",
  "New: tests/news/ (11 files, 96 tests) -- NewsItem validation, Mock/Finnhub/Official-RSS providers, the RSS/Atom parser (including the XXE-refusal and entity-decoding cases), source-config gating, formatting (escaping, mention neutralization, UTC time, length limit), dedup, flood control, config/approval gates, and full publisher/worker integration (routing, licensing gates, provider-failure isolation, duplicate-check-failure handling).",
  "Extended: tests/server.test.ts and tests/dryrun.test.ts now also cover the 3 webhook tools end to end through the MCP client.",
]);

// S ---------------------------------------------------------------------
section("S", "MCP Tool-Discovery Results");
para(
  "Queried live via mcp.listTools() through an in-memory MCP client/server " +
    "pair (the same mechanism the test suite uses) -- not reconstructed from " +
    "source by hand. Result: 25 tools registered, all 22 pre-existing tools " +
    "still present plus the 3 new webhook tools (list_webhooks, " +
    "create_webhook, delete_webhook). Destructive tools correctly flagged " +
    "(destructiveHint=true): delete_channel, delete_role, delete_message, " +
    "delete_webhook -- exactly the 4 confirm-gated tools, no more.",
);

// T ---------------------------------------------------------------------
section("T", "Remaining Steps Before the First Controlled Live Test");
bullets([
  "Owner reviews and, only if satisfied, sets NEWS_LICENSE_APPROVED=true for Finnhub (confirming the actual Finnhub plan permits the intended BULLHAUS redistribution) -- separately from any RSS decision.",
  "Owner reviews each RSS source's terms individually and flips enabled+approved in src/news/rss/sources.ts only for the ones cleared (fed_press_all, fed_press_monetary, ecb_press) -- crypto stays unconfigured until a suitable official source is identified.",
  "Run npm run news against a real (test) Discord bot token with NEWS_DRY_RUN still true, to verify duplicate-check reads against real channel history work as expected -- before ever flipping dry-run off.",
  "Only then set NEWS_DRY_RUN=false and NEWS_PUBLISH_ENABLED=true for a first controlled live post, ideally starting with a single category.",
  "Decide on and enable a GitHub Actions schedule (cron) only after at least one successful manual workflow_dispatch run, and wire real secrets into that workflow at that time -- not before.",
  "Separately from News: review the ServerStats/Server Bots role pairing per section P before making any live permission change.",
]);

doc.spacer(10);
doc.hr();
para(
  "Distinctions for the record: IMPLEMENTED = code exists and typechecks. " +
    "TESTED = covered by an automated test in this phase, always against a " +
    "mock/fake/local fixture, never a live external call. PREPARED BUT NOT " +
    "ACTIVATED = exists and is safe by default, but requires an explicit " +
    "Owner action (an approval flag, an enabled/approved source flip, or a " +
    "workflow schedule) before it can do anything live. Nothing in this " +
    "report claims a live/external integration (Finnhub, an RSS feed, or a " +
    "real Discord write) was successfully tested -- only mocked responses " +
    "and local fixtures were used.",
);

mkdirSync(OUT_DIR, { recursive: true });
const result = doc.save(OUT_FILE);
console.log(`Wrote ${OUT_FILE} (${result.pageCount} pages, ${result.byteLength} bytes)`);
