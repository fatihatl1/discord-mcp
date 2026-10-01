import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { isBullhausGuild } from "../config/bullhaus.js";
import { DiscordAPIError } from "../discord/client.js";
import {
  errorResult,
  jsonResult,
  runTool,
  SNOWFLAKE,
  type ToolContext,
} from "./shared.js";

export function registerDeleteWebhook(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "delete_webhook",
    {
      title: "Delete webhook (IRREVERSIBLE)",
      description:
        "Permanently delete a webhook in the configured BULLHAUS guild. " +
        "THIS IS IRREVERSIBLE. The exact webhook is fetched first and its " +
        "guild, name, and destination channel are checked against the " +
        "values you supply -- any mismatch aborts without deleting. " +
        "Requires confirm_delete=true. This tool never bulk-deletes and " +
        "never removes a webhook just because it looks inactive.",
      inputSchema: {
        guild_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
        webhook_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
        expected_webhook_name: z
          .string()
          .min(1)
          .describe("Must exactly match the webhook's current name"),
        expected_channel_id: z
          .string()
          .regex(SNOWFLAKE, "must be a Discord snowflake id")
          .describe("Must exactly match the webhook's current destination channel"),
        confirm_delete: z
          .boolean()
          .describe("Must be true. Confirms you understand this is irreversible."),
        reason: z.string().max(512).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({
      guild_id,
      webhook_id,
      expected_webhook_name,
      expected_channel_id,
      confirm_delete,
      reason,
    }) =>
      runTool("delete_webhook", async () => {
        if (!isBullhausGuild(guild_id)) {
          return errorResult(
            new Error(
              `Refusing to delete webhook: guild ${guild_id} is not the ` +
                "configured BULLHAUS guild. Webhook management is restricted " +
                "to that guild only.",
            ),
          );
        }

        const webhook = await ctx.api.getWebhook(webhook_id);

        if (!webhook.guild_id || !isBullhausGuild(webhook.guild_id)) {
          return errorResult(
            new Error(
              `Refusing to delete webhook ${webhook_id}: it belongs to a ` +
                `different guild (${webhook.guild_id ?? "unknown"}), not the ` +
                "configured BULLHAUS guild.",
            ),
          );
        }
        if (webhook.name !== expected_webhook_name) {
          return errorResult(
            new Error(
              `Refusing to delete webhook ${webhook_id}: name mismatch -- ` +
                `expected "${expected_webhook_name}", found "${webhook.name ?? ""}".`,
            ),
          );
        }
        if (webhook.channel_id !== expected_channel_id) {
          return errorResult(
            new Error(
              `Refusing to delete webhook ${webhook_id}: channel mismatch -- ` +
                `expected ${expected_channel_id}, found ${webhook.channel_id}.`,
            ),
          );
        }

        if (confirm_delete !== true) {
          return errorResult(
            new Error(
              "Refusing to delete webhook: confirm_delete=true is required.",
            ),
          );
        }

        if (ctx.dryRun) {
          return jsonResult({
            dry_run: true,
            note: "DRY_RUN is active; no webhook was deleted.",
            would_delete_webhook: {
              webhook_id,
              guild_id,
              channel_id: expected_channel_id,
              name: expected_webhook_name,
            },
          });
        }

        const deleteReason =
          reason ?? "discord-provisioner-mcp: delete webhook (confirmed by operator)";
        try {
          await ctx.api.deleteWebhook(webhook_id, deleteReason);
        } catch (err) {
          // A network-level failure (status 0, after the client's own
          // retries are exhausted) leaves genuine doubt about whether the
          // delete landed. Check existence once rather than blindly retrying
          // a possibly-already-applied delete.
          if (err instanceof DiscordAPIError && err.status === 0) {
            const stillExists = await webhookStillExists(ctx, webhook_id);
            if (!stillExists) {
              return {
                deleted_webhook_id: webhook_id,
                result: "deleted",
                guild_id,
                channel_id: expected_channel_id,
                note:
                  "The delete request timed out, but re-checking confirmed " +
                  "the webhook no longer exists.",
              };
            }
          }
          throw err;
        }

        return {
          deleted_webhook_id: webhook_id,
          result: "deleted",
          guild_id,
          channel_id: expected_channel_id,
        };
      }),
  );
}

async function webhookStillExists(
  ctx: ToolContext,
  webhookId: string,
): Promise<boolean> {
  try {
    await ctx.api.getWebhook(webhookId);
    return true;
  } catch (err) {
    if (err instanceof DiscordAPIError && err.status === 404) return false;
    // Any other error (including another timeout) is genuinely inconclusive;
    // treat the webhook as still present so the caller doesn't get a false
    // "deleted" result.
    return true;
  }
}
