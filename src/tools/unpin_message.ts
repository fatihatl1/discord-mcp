import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jsonResult, runTool, SNOWFLAKE, type ToolContext } from "./shared.js";

export function registerUnpinMessage(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "unpin_message",
    {
      title: "Unpin message",
      description: "Remove a message from its channel's pinned messages list.",
      inputSchema: {
        channel_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
        message_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ channel_id, message_id }) =>
      runTool("unpin_message", async () => {
        if (ctx.dryRun) {
          return jsonResult({
            dry_run: true,
            note: "DRY_RUN is active; no message was unpinned.",
            would_unpin_message: { channel_id, message_id },
          });
        }
        await ctx.api.unpinMessage(
          channel_id,
          message_id,
          "discord-provisioner-mcp: unpin message",
        );
        return { unpinned: { channel_id, message_id } };
      }),
  );
}
