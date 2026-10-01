import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  errorResult,
  jsonResult,
  publicMessage,
  runTool,
  SNOWFLAKE,
  type ToolContext,
} from "./shared.js";

export function registerEditMessage(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "edit_message",
    {
      title: "Edit message",
      description:
        "Edit the content of a message. Only messages authored by this " +
        "bot can be edited -- Discord does not allow editing messages " +
        "authored by anyone else (including other bots, users, or " +
        "webhooks), and this tool checks that before attempting the edit.",
      inputSchema: {
        channel_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
        message_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
        content: z.string().min(1).max(2000),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ channel_id, message_id, content }) =>
      runTool("edit_message", async () => {
        const [message, me] = await Promise.all([
          ctx.api.getMessage(channel_id, message_id),
          ctx.api.getCurrentUser(),
        ]);
        if (message.webhook_id !== undefined || message.author.id !== me.id) {
          return errorResult(
            new Error(
              `Refusing to edit: message ${message_id} in channel ` +
                `${channel_id} was not authored by this bot.`,
            ),
          );
        }

        if (ctx.dryRun) {
          return jsonResult({
            dry_run: true,
            note: "DRY_RUN is active; no message was edited.",
            would_edit_message: { channel_id, message_id, content },
          });
        }

        const updated = await ctx.api.editMessage(channel_id, message_id, {
          content,
        });
        return { message: publicMessage(updated) };
      }),
  );
}
