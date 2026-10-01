import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { isBullhausGuild } from "../config/bullhaus.js";
import {
  errorResult,
  jsonResult,
  publicWebhook,
  runTool,
  SNOWFLAKE,
  type ToolContext,
} from "./shared.js";

/**
 * Mirrors Discord's own webhook username rules (same rules as a nickname):
 * 1-80 chars, no "@", "#", ":", backtick, and not (a superstring containing,
 * case-insensitively) "clyde" or exactly "discord".
 */
function invalidWebhookNameReason(name: string): string | undefined {
  if (name.length < 1 || name.length > 80) {
    return "must be 1-80 characters";
  }
  if (/[@#:`]/.test(name)) {
    return 'must not contain "@", "#", ":", or a backtick';
  }
  const lower = name.toLowerCase();
  if (lower.includes("clyde")) return 'must not contain "clyde"';
  if (lower === "discord") return 'must not be exactly "discord"';
  return undefined;
}

export function registerCreateWebhook(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "create_webhook",
    {
      title: "Create webhook",
      description:
        "Create an incoming webhook on a channel in the configured " +
        "BULLHAUS guild. Requires confirm_create=true. Discord issues a " +
        "bearer token for the new webhook, but this tool NEVER returns, " +
        "logs, or persists it -- only sanitized metadata comes back. Using " +
        "the token from an external service requires a separately approved " +
        "secure credential-management workflow; the BULLHAUS News Worker " +
        "does not need one, since it publishes directly through BULLHAUS AI.",
      inputSchema: {
        guild_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
        channel_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
        name: z.string().min(1).max(80),
        confirm_create: z
          .boolean()
          .describe("Must be true. Confirms you intend to create this webhook."),
        reason: z.string().max(512).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ guild_id, channel_id, name, confirm_create, reason }) =>
      runTool("create_webhook", async () => {
        if (!isBullhausGuild(guild_id)) {
          return errorResult(
            new Error(
              `Refusing to create webhook: guild ${guild_id} is not the ` +
                "configured BULLHAUS guild. Webhook management is restricted " +
                "to that guild only.",
            ),
          );
        }

        const channels = await ctx.api.listGuildChannels(guild_id);
        const channel = channels.find((c) => c.id === channel_id);
        if (!channel) {
          return errorResult(
            new Error(
              `Refusing to create webhook: channel ${channel_id} does not ` +
                `belong to guild ${guild_id}.`,
            ),
          );
        }

        const nameProblem = invalidWebhookNameReason(name);
        if (nameProblem) {
          return errorResult(
            new Error(`Refusing to create webhook: invalid name -- ${nameProblem}.`),
          );
        }

        if (confirm_create !== true) {
          return errorResult(
            new Error(
              "Refusing to create webhook: confirm_create=true is required.",
            ),
          );
        }

        if (ctx.dryRun) {
          return jsonResult({
            dry_run: true,
            note: "DRY_RUN is active; no webhook was created.",
            would_create_webhook: { guild_id, channel_id, name },
          });
        }

        const webhook = await ctx.api.createWebhook(
          channel_id,
          { name },
          reason ?? "discord-provisioner-mcp: create webhook (confirmed by operator)",
        );
        return {
          webhook: publicWebhook(webhook),
          note:
            "Webhook created. Its token/execution URL is a credential and " +
            "was intentionally not returned; retrieve it from the Discord " +
            "developer portal / server settings if an approved external " +
            "integration needs it.",
        };
      }),
  );
}
