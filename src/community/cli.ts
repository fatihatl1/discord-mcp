#!/usr/bin/env node
/**
 * Entry point for the community role-sync worker (GitHub Actions / manual).
 *
 * Defaults to DRY RUN. A pass only writes when ROLE_SYNC_DRY_RUN is the exact
 * string "false" -- any other value, including unset, a typo or an empty
 * string, leaves the worker read-only. That is deliberate: this process runs
 * unattended every five minutes against a live community server, so the
 * failure mode of a misconfigured environment must be "did nothing".
 *
 * The bot token is read from DISCORD_BOT_TOKEN and registered with the
 * logger's redactor so it can never reach stdout or stderr.
 *
 * Exit codes: 0 = pass completed; 1 = the pass stopped on an error.
 */

import { BULLHAUS_GUILD_ID } from "../config/bullhaus.js";
import { DiscordClient } from "../discord/client.js";
import { DiscordEndpoints } from "../discord/endpoints.js";
import { configureLogging, log } from "../logging.js";
import { runRoleSync } from "./role_sync.js";

function envFlagIsExplicitlyFalse(name: string): boolean {
  return process.env[name] === "false";
}

async function main(): Promise<void> {
  const token = process.env["DISCORD_BOT_TOKEN"];
  configureLogging({ level: process.env["LOG_LEVEL"] ?? "info", redact: [token] });

  if (!token) {
    log.error("role sync aborted: DISCORD_BOT_TOKEN is not set");
    process.exitCode = 1;
    return;
  }

  // Dry run unless BOTH switches explicitly opt into writing. DRY_RUN is the
  // repo-wide kill switch the News Worker already honours; ROLE_SYNC_DRY_RUN
  // is this worker's own.
  const dryRun =
    !envFlagIsExplicitlyFalse("ROLE_SYNC_DRY_RUN") ||
    !envFlagIsExplicitlyFalse("DRY_RUN");

  // Second, independent layer: in dry-run the client itself refuses non-GET
  // requests, so even a logic bug in the executor cannot write.
  const client = new DiscordClient({ token, dryRun, writeDelayMs: 400 });
  const api = new DiscordEndpoints(client);

  log.info("community role sync starting", {
    guild_id: BULLHAUS_GUILD_ID,
    dry_run: dryRun,
    event: process.env["GITHUB_EVENT_NAME"] ?? "local",
  });

  try {
    const result = await runRoleSync(api, BULLHAUS_GUILD_ID, { dryRun });

    for (const op of result.planned) {
      log.info(`${dryRun ? "would " : ""}${op.kind} ${op.roleName}`, {
        user_id: op.userId,
        username: op.username,
        cohort: op.cohort,
        reason: op.reason,
        applied: result.applied.includes(op),
      });
    }

    log.info("community role sync finished", {
      dry_run: result.dryRun,
      members_scanned: result.membersScanned,
      humans_scanned: result.humansScanned,
      planned: result.planned.length,
      applied: result.applied.length,
      not_attempted: result.notAttempted.length,
    });

    if (result.failure) {
      log.error("community role sync stopped on a Discord API error", {
        user_id: result.failure.op.userId,
        role: result.failure.op.roleName,
        kind: result.failure.op.kind,
        error: result.failure.message,
      });
      process.exitCode = 1;
    }
  } catch (err) {
    log.error("community role sync failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  log.error("community role sync crashed", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exitCode = 1;
});
