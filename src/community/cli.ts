#!/usr/bin/env node
/**
 * Entry point for the community membership guard (GitHub Actions / manual).
 *
 * READ-ONLY by construction: this process calls only GET endpoints
 * (listGuildRoles, listGuildMembers) and never imports addMemberRole /
 * removeMemberRole / modifyRole. There is no dry-run flag because there is
 * nothing to run dry -- see membership_guard.ts for why Phase 5.1 retired
 * the write-capable version Phase 5 introduced.
 *
 * Exit codes: 0 = pass completed (with or without findings -- findings are
 * informational, not a failure); 1 = the pass itself errored.
 */

import { BULLHAUS_GUILD_ID } from "../config/bullhaus.js";
import { DiscordClient } from "../discord/client.js";
import { DiscordEndpoints } from "../discord/endpoints.js";
import { configureLogging, log } from "../logging.js";
import { runMembershipGuard } from "./membership_guard.js";

async function main(): Promise<void> {
  const token = process.env["DISCORD_BOT_TOKEN"];
  configureLogging({ level: process.env["LOG_LEVEL"] ?? "info", redact: [token] });

  if (!token) {
    log.error("membership guard aborted: DISCORD_BOT_TOKEN is not set");
    process.exitCode = 1;
    return;
  }

  // dryRun is forced true regardless of any env var: this tool has no write
  // path at all, and this is a second, independent layer against that ever
  // changing by accident -- any non-GET call would throw before the network.
  const client = new DiscordClient({ token, dryRun: true });
  const api = new DiscordEndpoints(client);

  log.info("membership guard starting", {
    guild_id: BULLHAUS_GUILD_ID,
    event: process.env["GITHUB_EVENT_NAME"] ?? "local",
  });

  try {
    const result = await runMembershipGuard(api, BULLHAUS_GUILD_ID);

    for (const v of result.violations) {
      log.warn("membership violation: gated role(s) held without MEMBER", {
        user_id: v.userId,
        username: v.username,
        roles: v.rolesHeldWithoutMember,
      });
    }

    log.info("membership guard finished", {
      members_scanned: result.membersScanned,
      humans_scanned: result.humansScanned,
      violations: result.violations.length,
    });
  } catch (err) {
    log.error("membership guard failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  log.error("membership guard crashed", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exitCode = 1;
});
