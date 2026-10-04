# discord-provisioner-mcp

An MCP (Model Context Protocol) server that lets an AI assistant provision
Discord servers -- guilds, categories, channels, roles, and permission
overwrites -- from a declarative blueprint.

- Talks to the Discord REST API directly (no discord.js); behaviour is
  explicit and dependencies stay thin (`@modelcontextprotocol/sdk` + `zod`).
- Plans before it acts: `apply_blueprint` diffs the blueprint against live
  state, applies only the difference, and never deletes anything.
- Running the same blueprint twice produces zero write operations the second
  time.
- Rate-limit aware: per-bucket queues, global 429 handling, serialised writes
  with a configurable inter-write delay.
- Two transports: stdio (Claude Code and other local clients) and Streamable
  HTTP with bearer auth (claude.ai custom connector).

## Requirements

- Node.js 20+
- A Discord application with a bot token

## Setup

```bash
npm install
npm run build
```

Copy `.env.example` to `.env` (or export the variables however you prefer)
and set at least `DISCORD_BOT_TOKEN`.

| Variable              | Required      | Default | Purpose                                        |
| --------------------- | ------------- | ------- | ---------------------------------------------- |
| `DISCORD_BOT_TOKEN`   | yes           | --      | Bot token from the developer portal            |
| `DISCORD_API_VERSION` | no            | `v10`   | REST API version segment                       |
| `DRY_RUN`             | no            | `false` | `true` = no write request ever reaches Discord |
| `LOG_LEVEL`           | no            | `info`  | `debug`, `info`, `warn`, `error`, `silent`     |
| `WRITE_DELAY_MS`      | no            | `250`   | Minimum delay between consecutive writes       |
| `MCP_AUTH_TOKEN`      | in HTTP mode  | --      | Bearer token HTTP clients must present         |

All logging goes to stderr as JSON lines. In stdio mode stdout carries the
MCP protocol, so nothing else ever writes to stdout. The bot token is
registered with the logger's redaction list and never appears in logs, error
messages, or tool output.

## Creating the Discord application and bot

1. Go to https://discord.com/developers/applications and click New
   Application.
2. Open the Bot tab and click Reset Token to reveal the bot token. Store it
   as `DISCORD_BOT_TOKEN`. Treat it like a password.
3. No privileged gateway intents are needed; this server uses REST only.

### Inviting the bot to an existing server

Use an OAuth2 URL with the `bot` scope. Minimum permissions for this server's
tools: Manage Channels, Manage Roles, View Channels. That permission set is
the integer `268436496` (`MANAGE_CHANNELS 16 + VIEW_CHANNEL 1024 +
MANAGE_ROLES 268435456`):

```
https://discord.com/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot&permissions=268436496
```

The person clicking the link needs Manage Server on the target guild.

### Two gotchas worth knowing up front

- **10-guild limit on `create_guild`.** Discord only lets a bot create
  guilds while it is a member of fewer than 10. `get_bot_info` reports your
  headroom, and `create_guild` fails with a clear message when over the
  limit. The normal path at scale: create the server manually, invite the
  bot, then run `apply_blueprint`.
- **Role hierarchy.** A bot can only manage roles strictly below its own
  highest role. If role creation or overwrite calls fail with Missing
  Permissions (50013) or 403 even though the bot has Manage Roles, drag the
  bot's role above the roles it manages in Server Settings -> Roles. This is
  the most common confusing failure; the error hint calls it out.

## Running

### stdio (default)

```bash
node dist/index.js
```

or during development:

```bash
npm run dev
```

### Streamable HTTP

```bash
MCP_AUTH_TOKEN=some-long-random-string node dist/index.js --http --port 3000
```

- Endpoint: `POST/GET/DELETE http://127.0.0.1:3000/mcp` (plus `GET /healthz`,
  unauthenticated).
- Every `/mcp` request must send `Authorization: Bearer <MCP_AUTH_TOKEN>`;
  anything else gets a 401. The comparison is constant-time.
- Sessions follow the Streamable HTTP spec: the `initialize` response carries
  an `mcp-session-id` header, later requests echo it, `DELETE` ends the
  session.
- Binds `127.0.0.1` by default; pass `--host 0.0.0.0` to expose it (put TLS
  in front first).

## Registering with Claude Code

```bash
claude mcp add discord \
  -e DISCORD_BOT_TOKEN=your-bot-token \
  -- node /absolute/path/to/discord-mcp/dist/index.js
```

Or in a project `.mcp.json`:

```json
{
  "mcpServers": {
    "discord": {
      "command": "node",
      "args": ["/absolute/path/to/discord-mcp/dist/index.js"],
      "env": {
        "DISCORD_BOT_TOKEN": "your-bot-token"
      }
    }
  }
}
```

## Registering as a claude.ai custom connector

1. Run in HTTP mode behind a public HTTPS URL (reverse proxy or tunnel --
   e.g. Cloudflare Tunnel -- terminating TLS in front of `--http --port 3000`).
2. In claude.ai: Settings -> Connectors -> Add custom connector, and give it
   `https://your-host/mcp`.
3. Auth caveat: the custom connector UI does not let you attach an arbitrary
   static bearer header. If your connector setup cannot send
   `Authorization: Bearer <MCP_AUTH_TOKEN>`, put the token injection in the
   fronting proxy (add the header there) and restrict who can reach the
   proxy. Do not expose the server without the bearer check.

## Tool surface

Read:

| Tool            | Purpose                                                        |
| --------------- | -------------------------------------------------------------- |
| `list_guilds`   | Guilds the bot is in                                           |
| `get_guild`     | Guild settings + full role list (permissions decoded to names) |
| `list_channels` | All channels incl. categories, overwrites decoded              |
| `list_roles`    | All roles, highest first                                       |
| `get_bot_info`  | Bot identity, guild count, 10-guild headroom                   |
| `get_blueprint_template` | Ready-made blueprints for common community types      |
| `list_messages`  | Recent messages in a channel; author, bot/webhook status, embeds |
| `get_role`       | One role by id: position, color, managed, decoded permissions, tags |
| `get_member`     | One guild member by user id: roles (ids + resolved names), nickname, bot flag |
| `list_role_members` | Every member carrying a given role (needs the privileged GUILD_MEMBERS intent -- see below) |
| `get_effective_permissions` | Computed server + channel permissions for a real member or a hypothetical role set, with a reasoning trace |

Write:

| Tool                      | Purpose                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| `create_guild`            | `POST /guilds` -- whole structure in one request via a blueprint |
| `apply_blueprint`         | The main tool: diff blueprint vs live state, apply the diff      |
| `create_role`             | One role; permissions as names, color as hex                     |
| `create_channel`          | One channel/category, with optional overwrites                   |
| `edit_channel`            | Modify an existing channel by id (PATCH) -- never a replacement  |
| `set_channel_permissions` | Set (replace) one role/member overwrite on a channel             |
| `reorder_channels`        | Bulk channel positions / parents                                 |
| `reorder_roles`           | Bulk role positions                                              |
| `send_message`            | Send a text message to a channel; optional `suppress_embeds`     |
| `edit_message`            | Edit the content of a message this bot authored                  |
| `pin_message`             | Pin a message                                                     |
| `unpin_message`           | Unpin a message                                                   |
| `list_webhooks`           | List sanitized webhook metadata for the BULLHAUS guild            |
| `create_webhook`          | Create an incoming webhook on a BULLHAUS-guild channel            |
| `edit_role_permissions`   | PATCH an existing role's permission bitfield in place by id (exact or incremental), with hierarchy/self-role/Administrator safety gates |
| `edit_role`               | PATCH an existing role's name/color/hoist/mentionable in place by id |
| `edit_role_position`      | PATCH a single role's position in place by id                     |

Destructive (gated -- `delete_channel`/`delete_role`/`delete_webhook` require
`confirm`/`confirm_delete: true` and say so in their descriptions; there is
deliberately no `delete_guild` tool, and no tools for kicking/banning members
or bulk-deleting messages):

| Tool             | Purpose                                                        |
| ---------------- | ---------------------------------------------------------------|
| `delete_channel` | Permanently delete a channel                                   |
| `delete_role`    | Permanently delete a role                                      |
| `delete_message` | Permanently delete one message; retrieved and validated first  |
| `delete_webhook` | Permanently delete a webhook; guild/name/channel checked first |

Every tool returns structured JSON text. Failures return an MCP error result
carrying the Discord error code, message, field details, and an actionable
hint -- never a thrown exception that kills the process. Every write sends an
`X-Audit-Log-Reason` header so actions are traceable in the guild's audit
log.

## Direct role and member tooling

`apply_blueprint` diffs a whole blueprint against live state and is not
meant for one-off edits to an existing role -- a dry run against a guild with
managed/integration roles already present can misread one as a role the
blueprint doesn't know about. `get_role`, `edit_role`, `edit_role_permissions`,
`edit_role_position`, `get_member`, `list_role_members`, and
`get_effective_permissions` operate on explicit `role_id`/`user_id` values
instead, PATCHing an existing role in place and never creating a replacement.

**dry_run defaults to true** on every one of these mutation tools (stricter
than the older write tools, which rely solely on the `DRY_RUN` env var). A
dry run returns a before/requested-change/after preview and sends zero
requests to Discord; the env `DRY_RUN=true` still forces a dry run even when
a caller passes `dry_run: false` (`forced_by_env` in the response says so).

**Administrator safety.** `edit_role_permissions` never silently grants
`ADMINISTRATOR`: adding it requires `allow_administrator: true` on the same
call, or the tool refuses with `ADMINISTRATOR_OPT_IN_REQUIRED`. Removing it
needs no such flag.

**Role hierarchy.** Before any of the three mutation tools write, the bot
looks up its own highest role (via `get_member` on itself) and refuses to
touch a role at or above that position with `ROLE_HIERARCHY_BLOCKED` --
checked up front, including during a dry-run preview, so the preview never
shows an outcome Discord would reject anyway. This also covers `@everyone`
(always position 0) and `edit_role_position`'s target.

**Self-role protection.** The bot will never edit its own managed
integration role (the one Discord auto-creates for a bot application),
regardless of hierarchy: that specific case returns `SELF_ROLE_EDIT_BLOCKED`.
This is an intentional boundary, not a bug -- it is not worked around.

**Managed (integration) roles in general.** A managed role that is *not* the
bot's own (e.g. a linked-role or another bot's role) is not pre-emptively
blocked -- hierarchy and dry-run previews work on it normally, since Discord,
not this server, is the authority on which managed roles can be edited. If
the real PATCH is rejected because the role is integration-managed, the
error comes back as `DISCORD_REJECTED_MANAGED_ROLE_EDIT` carrying Discord's
actual status/code/message -- never papered over with a fallback role
creation or a silent no-op.

**Member listing and the privileged intent.** `get_member` (fetching one
member by id) needs nothing beyond normal bot permissions and was confirmed
live against the real BULLHAUS guild. `list_role_members` (and the
underlying `GET /guilds/{guild}/members` endpoint) requires the
**GUILD_MEMBERS privileged intent** to be enabled for the application in the
Discord developer portal (Bot tab) -- a REST-only server like this one never
opens a Gateway connection, but Discord still gates that endpoint behind the
same application-level toggle used for the Gateway intent. Confirmed live
against the real BULLHAUS guild: without the intent enabled, Discord does
**not** silently return an empty list -- it rejects the request outright
(`403`, code `50001` "Missing Access"). `list_role_members` surfaces this as
a structured `GUILD_MEMBERS_INTENT_REQUIRED` error rather than the generic
"bot can't see this channel" hint that error code would otherwise carry.
This server does not and cannot flip that toggle for you, since it's an
application setting in the developer portal, not something configurable at
runtime -- enable Server Members Intent there if you need this tool.

**get_effective_permissions** computes Discord's actual documented
precedence (not an approximation): `@everyone` base, OR'd with held roles,
short-circuited to every permission when `ADMINISTRATOR` is present; for a
channel, the parent category's overwrites are applied as one layer and the
channel's own overwrites as a second layer on top, each layer resolving
`@everyone` deny-then-allow, then the union of all applicable role
deny/allow, then (for a real member) a member-specific overwrite. It accepts
either a real `user_id` or a hypothetical `role_ids` set (for "what would a
Member/VIP-type role combination see" questions), and returns the
contributing roles plus a step-by-step reasoning trace.

## Server design layer

The server ships opinionated design knowledge so assistants produce sensible
layouts instead of inventing conventions per request:

- **Templates** -- `get_blueprint_template` returns a complete starter
  blueprint for a community type: `gaming`, `dev`, `support`, or `creator`.
  Call it without arguments to list them. Each follows the conventions
  below (INFORMATION category first, locked info channels, Admin > Mod >
  status > Member ladder, private STAFF area, sane @everyone baseline).
- **Design guide** -- the MCP resource `discord://design-guide`
  (markdown): category ordering, standard channels, role ladders,
  permission patterns, guild settings, and the dry-run-first workflow.
- **Prompt** -- the MCP prompt `design_server` (arguments:
  `community_type`, `requirements`) bundles the guide plus the matching
  template into a single message, for clients with prompt support.

Typical flow: assistant lists templates, fetches the closest one, tailors
names/roles/channels to the request, then runs `apply_blueprint` with
`dry_run: true` for review before writing.

## Blueprint format

A blueprint is a JSON object (the `blueprint` parameter also accepts a JSON
string). YAML shown here for readability -- it maps 1:1 onto the JSON; if you
author in YAML, convert it to JSON before passing it in (no YAML parser is
bundled, by design, to keep dependencies thin).

```yaml
name: "Example Server"
everyone_permissions: [VIEW_CHANNEL, READ_MESSAGE_HISTORY]
roles:
  - name: "Admin"
    color: "#e74c3c"
    hoist: true
    permissions: [ADMINISTRATOR]
  - name: "Member"
    permissions: [VIEW_CHANNEL, SEND_MESSAGES, READ_MESSAGE_HISTORY, ADD_REACTIONS]
categories:
  - name: "INFORMATION"
    private_to: []              # empty = public
    channels:
      - name: "announcements"
        type: announcement
        locked: true            # shorthand: @everyone denied SEND_MESSAGES
      - name: "rules"
        type: text
        locked: true
  - name: "STAFF"
    private_to: [Admin]         # shorthand: @everyone denied VIEW_CHANNEL, Admin allowed
    channels:
      - name: "staff-chat"
        type: text
```

### Field reference

Root:

| Field                           | Type            | Notes                                            |
| ------------------------------- | --------------- | ------------------------------------------------ |
| `name`                          | string (2-100)  | Guild name (used by `create_guild`)              |
| `everyone_permissions`          | permission[]    | Baseline permissions of the `@everyone` role     |
| `roles`                         | role[]          | Order = role list order, top first               |
| `categories`                    | category[]      | Order = category order                           |
| `channels`                      | channel[]       | Top-level channels outside any category          |
| `icon`                          | data URI        | `data:image/png;base64,...` (create_guild only)  |
| `verification_level`            | 0-4             | Optional guild setting                           |
| `default_message_notifications` | 0-1             | Optional guild setting                           |
| `explicit_content_filter`       | 0-2             | Optional guild setting                           |
| `afk_timeout`                   | 60/300/900/1800/3600 | Optional guild setting                      |
| `system_channel`                | channel name    | Must be a text/announcement channel defined here |
| `afk_channel`                   | channel name    | Must be a voice channel defined here             |

Role: `name` (required), `color` (hex string), `hoist`, `mentionable`,
`permissions` (array of permission names).

Category: `name` (required), `private_to`, `locked`, `overwrites`,
`channels`.

Channel: `name` (required), `type` (`text` default, `voice`, `announcement`,
`stage`, `forum`, `media`), `topic`, `nsfw`, `rate_limit_per_user`,
`locked`, `private_to`, `overwrites`.

Overwrite (the escape hatch when shorthands are not enough):

```yaml
overwrites:
  - role: "Member"          # a role name from roles[], or "@everyone"
    allow: [VIEW_CHANNEL]
    deny: [SEND_MESSAGES]
```

Permission names are the documented Discord constants (`VIEW_CHANNEL`,
`SEND_MESSAGES`, `MANAGE_ROLES`, `MODERATE_MEMBERS`, ...). An unknown name
fails validation with the full list of valid options. Bit positions are
verified against the current Discord docs; bitfields are computed with
BigInt and serialised as strings, never JavaScript numbers.

### Semantics

- **Roles are referenced by name** everywhere (in `private_to` and
  `overwrites`). Resolution to snowflake ids happens at apply time. A
  reference to a role not defined in `roles[]` is a validation error caught
  before any API call.
- **`private_to: [RoleA]`** denies `VIEW_CHANNEL` for `@everyone` and allows
  it for each listed role -- the standard private-channel pattern. An empty
  array means public.
- **`locked: true`** denies `SEND_MESSAGES` for `@everyone`.
- **Category inheritance.** A child channel that states nothing
  overwrite-related inherits the category's overwrites exactly (the way
  Discord's UI syncs new channels to their category). A child that states
  anything merges with the category per role and per bit, and the child wins
  on conflicts. So `locked: true` inside a private category keeps the
  privacy and adds the lock, and an explicit
  `overwrites: [{ role: "@everyone", allow: [VIEW_CHANNEL] }]` can punch a
  public window into a private category.
- **Contradictions are errors.** Allowing and denying the same permission
  for the same role at the same level fails validation.
- **Omitted fields are unmanaged.** A role without `permissions` (or a
  channel without `topic`) is created with Discord defaults and never
  diffed, so reconcile will not fight manual changes to fields the
  blueprint does not mention. State a field to manage it.
- **Channel names are normalised** the way Discord stores them: text-like
  channels become lowercase-kebab (`"Staff Chat"` -> `staff-chat`). Matching
  and idempotency use the normalised name. Duplicate normalised names within
  the same category are a validation error.

## Planning, idempotency, orphans

`apply_blueprint(guild_id, blueprint, mode, dry_run)`:

1. Validates the blueprint (schema, role references, contradictions). This
   is a separate pass; nothing is fetched or written if it fails.
2. Fetches live roles and channels.
3. Matches blueprint entities to live entities by name and produces an
   ordered plan: `@everyone` permissions -> create roles -> update roles ->
   set role positions -> create categories -> create channels -> update
   channels -> apply overwrites.
4. Skips anything that already matches; in `reconcile` mode updates anything
   that differs; in `create_only` mode (the default, the conservative
   choice) only creates what is missing and reports differing entities under
   `skipped`.
5. **Never deletes anything.** Live roles/channels the blueprint does not
   mention are reported under `orphans` for you to decide about (the gated
   delete tools exist for that).

`dry_run: true` validates everything and returns the full ordered plan
without a single write call. `DRY_RUN=true` in the environment forces this
for every write tool in the server, with a second guard at the HTTP client
level -- both are covered by tests.

Applying the same blueprint twice yields zero operations the second time
(tested at both the planner and the full-tool level).

Overwrite management scope: on channels the blueprint defines, role-type
overwrites for roles the blueprint knows about (and `@everyone`) are fully
converged -- including removing ones the blueprint no longer wants.
Member-type overwrites and overwrites for roles outside the blueprint are
never touched.

If an apply fails partway (e.g. a permission error), it stops, reports what
was applied and what failed, and re-running is safe -- the next run diffs
from wherever things stand.

## Rate limiting

Provisioning a server means dozens of rapid writes, so the client:

- Tracks `X-RateLimit-Bucket`, `X-RateLimit-Remaining`,
  `X-RateLimit-Reset-After`, and serialises requests sharing a bucket.
- On 429 reads `retry_after` from the JSON body and sleeps; a 429 with
  `X-RateLimit-Scope: global` pauses ALL requests, not just that bucket.
  Gives up after 10 consecutive 429s on one request.
- Retries 5xx and network errors with jittered exponential backoff, max 5
  attempts. Never retries any other 4xx.
- Serialises ALL writes through a single queue with `WRITE_DELAY_MS`
  (default 250 ms) between them, because role/channel creation is limited
  far more aggressively than reads. Raise it if you still see 429s.

## Error mapping

Discord's numeric `code` and nested `errors` field paths are surfaced on
every failure, plus a hint for the common cases:

| Code / status | Meaning                  | Hint                                                        |
| ------------- | ------------------------ | ----------------------------------------------------------- |
| 50001         | Missing Access           | Bot cannot see the guild/channel; check membership and VIEW_CHANNEL |
| 50013         | Missing Permissions      | Bot lacks Manage Roles/Channels, or the target role is at/above the bot's top role |
| 30013         | Max guilds               | The 10-guild bot creation limit; invite the bot to an existing server instead |
| 30005 / 30011 / 30xxx | Resource limits  | Role (250) / channel (500) / other Discord limits           |
| 50035         | Invalid Form Body        | Includes the exact field path(s) from Discord's response    |
| 401           | Bad token                | Re-copy `DISCORD_BOT_TOKEN` from the portal                 |
| 403           | Forbidden                | Usually role hierarchy -- move the bot's role up            |

## Development

```bash
npm run dev        # tsx, stdio mode
npm test           # vitest; the HTTP layer is stubbed, no network calls
npm run typecheck
npm run build
npm run news:dry    # News Worker, fully offline (Mock Provider)
npm run news        # News Worker, respects env config (see "News Worker" above)
```

## Decisions and assumptions

Choices made where the spec left room, leaning conservative:

- `apply_blueprint` defaults to `create_only`; `reconcile` is opt-in.
- Nothing is ever deleted by the blueprint path; orphans are reported only.
  Member-type overwrites and overwrites for non-blueprint roles are
  preserved even in reconcile.
- Omitted blueprint fields (role `permissions`, channel `topic`, ...) are
  unmanaged rather than treated as "set to default".
- Blueprint `roles` order defines the top-to-bottom role order. Reconcile
  fixes relative order; `create_only` never repositions existing roles.
  Existing channels are not repositioned by reconcile either (creation sets
  positions; use `reorder_channels` for manual fixes).
- A live channel whose type differs from the blueprint's is reported as a
  `conflict` (Discord cannot convert most types); no action is taken.
- Blueprints arrive as JSON (object or string). YAML is documentation-side
  only, to avoid another dependency.
- 429s are retried up to 10 times per request; 5xx up to 5 attempts.
- Apply stops at the first failed operation rather than continuing blind.
- HTTP mode binds `127.0.0.1` unless `--host` says otherwise, and refuses to
  start without `MCP_AUTH_TOKEN`.
- Bot-integration (managed) roles are never matched, updated, or listed as
  orphans.

## Security notes

- The bot token and MCP auth token are redacted from every log line as a
  last line of defense; they are never placed in tool output or error
  messages in the first place.
- `delete_channel` / `delete_role` require `confirm: true` and are labelled
  irreversible; there is no `delete_guild` tool.
- Prefer `DRY_RUN=true` plus `apply_blueprint(dry_run: true)` to review the
  plan before letting it write.
- `edit_message` only edits messages authored by this bot (checked against
  `getCurrentUser()` before the write, not left to Discord's own rejection).
- `delete_message` retrieves and validates the exact message before deleting
  it and only ever deletes one message per call; there is no bulk-delete
  tool.
- `list_messages` never returns raw Discord response objects -- only an
  explicit allow-list of fields (id, author, bot/webhook status, timestamps,
  content, minimal embed metadata), so a webhook token could never leak even
  if a future Discord response included one.
- No tool exists for kicking/banning members, deleting a guild, transferring
  guild ownership, or granting the `ADMINISTRATOR` permission.
- `list_webhooks`, `create_webhook`, and `delete_webhook` are restricted to
  the single guild configured in `src/config/bullhaus.ts`
  (`DISCORD_GUILD_ID`, default the BULLHAUS guild). A webhook's `token` and
  execution `url` are bearer credentials -- `publicWebhook()` in
  `tools/shared.ts` allow-lists every field it returns, so neither can ever
  reach tool output, logs, or an error message, even if a future Discord
  response field carried one.
- `create_webhook` requires `confirm_create: true` and validates the target
  channel belongs to the configured guild first. `delete_webhook` requires
  `confirm_delete: true` and re-fetches the exact webhook to verify its
  guild, name, and destination channel match what the caller expects before
  deleting anything; any mismatch aborts without touching Discord. Neither
  tool bulk-deletes, and nothing is ever removed just because it looks
  inactive.
- A newly created incoming webhook's token is never printed, logged, or
  stored by this project. An external service that needs it requires a
  separately approved secure credential-management workflow -- the BULLHAUS
  News Worker does not need one, since it publishes through the bot directly.

## News Worker

An independent worker (`src/news/`) that posts market/forex/crypto news into
the BULLHAUS guild's News channels through the bot itself -- no incoming
webhook required. It runs standalone (`npm run news`), outside of Claude
Desktop/MCP, and is designed to be triggered by GitHub Actions or a
scheduler later; nothing here activates automatic publishing.

**Commands**

```bash
npm run news:dry   # fully offline: Mock Provider, no credentials, previews only
npm run news       # respects env config below; still dry-run by default
```

**Providers** -- a shared `NewsProvider` interface (`src/news/provider.ts`)
so the worker never depends on a specific source. Select which are active
with `NEWS_PROVIDERS` (comma-separated; default `mock`):

| Provider       | Role                        | File                                          | Needs                | Notes |
| -------------- | --------------------------- | ---------------------------------------------- | --------------------- | ----- |
| `finnhub`      | **Intended production provider** | `providers/finnhub_provider.ts`                | `FINNHUB_API_KEY`      | Finnhub Market News API (`general`/`forex`/`crypto`). Gated by `NEWS_LICENSE_APPROVED` -- see Licensing below. Market News carries **no** authoritative impact field; see "Estimated Impact" below. |
| `mock`         | Development/testing only    | `providers/mock_provider.ts`                   | nothing                | Clearly fictional fixtures (`[FICTIONAL] ...`, `example.com` links). **Hard-blocked from live publication in code**, regardless of config. |
| `official_rss` | Implemented, disabled       | `providers/official_rss_provider.ts`           | nothing (feeds are public) | Only fetches sources that are both `enabled` and `approved` in `rss/sources.ts` -- every shipped source ships with both `false`, so this provider is currently inert. Kept in the codebase (not deleted) so it can be enabled later without an architecture change. |

Multiple providers can be listed together (`NEWS_PROVIDERS=mock,finnhub`);
they are never combined automatically -- only what's explicitly configured
runs. The provider abstraction is intentionally generic so a future provider
(or the Official RSS provider, once approved) can be added without changing
worker/formatting/dedup code.

**Official RSS sources** (`src/news/rss/sources.ts`) -- one central,
Owner-editable list; every URL was verified live against the institution's
own site, never invented or mirrored:

| id | Institution | Category | Enabled | Approved |
| -- | ----------- | -------- | ------- | -------- |
| `fed_press_all` | Board of Governors of the Federal Reserve System | general | no | no |
| `fed_press_monetary` | Board of Governors of the Federal Reserve System | forex (keyword-filtered) | no | no |
| `ecb_press` | European Central Bank | general | no | no |

Every source ships `enabled: false, approved: false` -- a feed only starts
being fetched once the Owner flips both flags after reviewing its
redistribution terms. No crypto RSS source is configured: no verified,
appropriately licensed official crypto-regulator feed was identified: the
Mock Provider still exercises Crypto News end to end.

**Channel mapping** (`src/config/bullhaus.ts`, Phase 3G.3 channel ids --
never the old, deleted News channels):

| Category | Channel |
| -------- | ------- |
| `general` | `1554782909272039476` (Trading News) |
| `forex`   | `1554783055535804470` (Forex News) |
| `crypto`  | `1554838955294195863` (Crypto News) |

**Message format** (`src/news/format.ts`) -- exactly headline, publisher,
Europe/Zurich local time, the Estimated Impact line, and the original link;
no emoji, no article body/summary, no images, no generated trading takes:

```
**Headline**
Publisher · HH:MM CET/CEST
Estimated Impact: High
[Read article](ARTICLE_URL)
```

The time is always the `Europe/Zurich` local clock (`CET` in winter, `CEST`
in summer), computed from the actual DST-aware UTC offset at that instant --
never a fixed numeric offset, never the machine's own timezone, and never
displayed as `UTC`/`GMT`/`MEZ`/`MESZ`. `Estimated Impact` is always exactly
one of `Low`, `Medium`, or `High` -- no "Middle", no star symbols, no
colors, no embeds. Discord markdown control characters are escaped and
every `@` is broken up with a zero-width space, so a headline can never
inject formatting or an unintended `@everyone`/role/user mention. Every
post is sent with `suppress_embeds: true`.

**Estimated Impact** (`src/news/impact.ts`) -- Finnhub Market News does not
provide an authoritative Low/Medium/High impact rating, so this project
never labels the estimate "Finnhub Impact" or implies Finnhub assigned it.
`Estimated Impact` is a BULLHAUS-owned, deterministic heuristic computed
locally from the category and headline (never the summary, never future
price movement) -- see `impact.ts` for the exact keyword rules. It is
informational only, not a trading recommendation: the classifier never
produces a trade direction, price target, or probability forecast. Every
`NewsItem` carries `estimatedImpact` plus `impactSource`, which is always
`"bullhaus_heuristic"` for every provider shipped today; `"provider"` is
reserved for a future source that supplies a genuine impact field, which
`validateNewsItem` (`types.ts`) never overwrites with the heuristic. Note
that Finnhub's separate Economic Calendar dataset does carry its own impact
field -- that is a different Finnhub endpoint and is **not** used by this
project in this phase.

**Duplicate prevention** (`src/news/dedup.ts`) -- before publishing, the
worker scans up to `NEWS_HISTORY_LOOKBACK` (default 100) recent messages in
the target channel, keeps only this bot's own non-pinned posts, and extracts
their article links to build an "already published" set. This is a bounded
window, not a permanent database (a persistent store could sit behind the
same interface later). If the history read itself fails, the worker does
**not** assume history is empty -- it skips publishing to that channel for
the run rather than risk a duplicate.

**Flood control** (`src/news/flood_control.ts`) -- `NEWS_MAX_AGE_MINUTES`
(default 60) drops stale items; the rest are sorted oldest-first and capped
at `NEWS_MAX_POSTS_PER_CHANNEL` (default 3) per channel per run, so a
provider backlog can never flood a channel in one pass.

**Publication approval gates** (`src/news/config.ts`) -- every gate defaults
closed:

- `NEWS_DRY_RUN` (default `true`) -- while true, no Discord write happens at
  all; enforced both in the publisher and, for the real client, a second
  time at the HTTP layer (`DiscordClient`'s own `dryRun`).
- `NEWS_PUBLISH_ENABLED` (default `false`) -- master switch; on its own
  approves nothing.
- `NEWS_LICENSE_APPROVED` (default `false`) -- Finnhub-specific
  redistribution approval. Being on Finnhub's free tier does **not** imply
  this should be `true`; confirm the actual plan's license permits the
  intended BULLHAUS publication model first. Approving Finnhub never
  approves an RSS source, and vice versa -- RSS approval is per-source
  (`approved` in `rss/sources.ts`).
- The Mock Provider is hard-blocked from live publication in code
  (`isProviderPublishable` in `config.ts`), independent of every flag above.

**Error handling** -- a provider failing, an RSS source failing, or a
missing API key never crashes the worker or blocks unrelated
providers/categories; it's logged and that source's items are simply absent
that run. A failed duplicate check is the one exception that **does** stop
publication -- into that one channel, for that one run.

**GitHub Actions** (`.github/workflows/news-worker.yml`) -- prepared but not
activated: `workflow_dispatch` only, no cron schedule, `permissions:
contents: read`, single-run concurrency group, and it runs `npm run
news:dry` (dry-run, offline-capable). Commented-out secret references show
where real credentials would go for a future production run; none are wired
up yet, and this workflow has not been pushed to GitHub.

**Future live deployment** -- going live for real requires, at minimum:
DISCORD_BOT_TOKEN configured wherever the worker runs; NEWS_DRY_RUN=false;
NEWS_PUBLISH_ENABLED=true; for Finnhub, a confirmed license and
NEWS_LICENSE_APPROVED=true; for any RSS source, the Owner reviewing its
terms and flipping its `enabled`/`approved` fields individually; and only
then enabling a schedule on the GitHub Actions workflow (still not done by
this phase).
