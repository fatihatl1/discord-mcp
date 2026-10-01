import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CreateMessagePayload } from "../discord/endpoints.js";
import { MESSAGE_FLAGS } from "../discord/types.js";
import { jsonResult, runTool, SNOWFLAKE, type ToolContext } from "./shared.js";

export function registerSendMessage(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "send_message",
    {
      title: "Send message",
      description:
        "Send a text message to a channel. Set suppress_embeds to send it " +
        "with Discord's SUPPRESS_EMBEDS flag, which stops link previews " +
        "from expanding under the message.",
      inputSchema: {
        channel_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
        content: z.string().min(1).max(2000),
        suppress_embeds: z
          .boolean()
          .default(false)
          .describe("Send with Discord's SUPPRESS_EMBEDS flag to disable link previews"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ channel_id, content, suppress_embeds }) =>
      runTool("send_message", async () => {
        if (ctx.dryRun) {
          return jsonResult({
            dry_run: true,
            note: "DRY_RUN is active; no message was sent.",
            would_send_message: { channel_id, content, suppress_embeds },
          });
        }
        const payload: CreateMessagePayload = { content };
        if (suppress_embeds) payload.flags = MESSAGE_FLAGS.SUPPRESS_EMBEDS;
        const message = await ctx.api.createMessage(channel_id, payload);
        return {
          message_id: message.id,
          channel_id: message.channel_id,
          timestamp: message.timestamp,
        };
      }),
  );
}
