import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jsonResult, runTool, SNOWFLAKE, type ToolContext } from "./shared.js";

export function registerDeleteMessage(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "delete_message",
    {
      title: "Delete message (IRREVERSIBLE)",
      description:
        "Permanently delete a single message. THIS IS IRREVERSIBLE. The " +
        "message is retrieved and validated to exist in the given channel " +
        "before it is deleted. This tool only ever deletes one message at " +
        "a time -- there is no bulk-delete operation.",
      inputSchema: {
        channel_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
        message_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ channel_id, message_id }) =>
      runTool("delete_message", async () => {
        // Retrieve and validate the exact message before deletion -- this
        // also confirms it actually belongs to channel_id, since Discord
        // 404s a message id/channel id mismatch.
        const message = await ctx.api.getMessage(channel_id, message_id);

        if (ctx.dryRun) {
          return jsonResult({
            dry_run: true,
            note: "DRY_RUN is active; no message was deleted.",
            would_delete_message: { channel_id, message_id },
          });
        }

        await ctx.api.deleteMessage(
          channel_id,
          message_id,
          "discord-provisioner-mcp: delete message (confirmed by operator)",
        );
        return {
          deleted: { id: message.id, channel_id, author_id: message.author.id },
          note: "Message permanently deleted.",
        };
      }),
  );
}
