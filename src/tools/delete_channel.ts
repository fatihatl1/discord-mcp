import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorResult, jsonResult, runTool, SNOWFLAKE, type ToolContext } from "./shared.js";

export function registerDeleteChannel(
  server: McpServer,
  ctx: ToolContext,
): void {
  server.registerTool(
    "delete_channel",
    {
      title: "Delete channel (IRREVERSIBLE)",
      description:
        "Permanently delete a channel or category. THIS IS IRREVERSIBLE: " +
        "all messages in the channel are lost and cannot be restored. " +
        "Requires confirm=true as an explicit acknowledgement.",
      inputSchema: {
        channel_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
        confirm: z
          .boolean()
          .describe("Must be true. Confirms you understand this is irreversible."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ channel_id, confirm }) =>
      runTool("delete_channel", async () => {
        if (confirm !== true) {
          return errorResult(
            new Error(
              "Refusing to delete: confirm=true is required. Deleting a " +
                "channel is irreversible and destroys its message history.",
            ),
          );
        }
        if (ctx.dryRun) {
          return jsonResult({
            dry_run: true,
            note: "DRY_RUN is active; no channel was deleted.",
            would_delete_channel: channel_id,
          });
        }
        const channel = await ctx.api.deleteChannel(
          channel_id,
          "discord-provisioner-mcp: delete channel (confirmed by operator)",
        );
        return {
          deleted: { id: channel.id, name: channel.name },
          note: "Channel permanently deleted.",
        };
      }),
  );
}
