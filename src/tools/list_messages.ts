import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { publicMessage, runTool, SNOWFLAKE, type ToolContext } from "./shared.js";

export function registerListMessages(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "list_messages",
    {
      title: "List messages",
      description:
        "List recent messages in a channel, newest first. Each message " +
        "reports its author (with bot/webhook status) and useful embed " +
        "metadata; webhook tokens are never included.",
      inputSchema: {
        channel_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
        limit: z.number().int().min(1).max(100).default(50),
        before: z
          .string()
          .regex(SNOWFLAKE)
          .optional()
          .describe("Only messages before this message id"),
        after: z
          .string()
          .regex(SNOWFLAKE)
          .optional()
          .describe("Only messages after this message id"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ channel_id, limit, before, after }) =>
      runTool("list_messages", async () => {
        const query: { limit: number; before?: string; after?: string } = {
          limit,
        };
        if (before !== undefined) query.before = before;
        if (after !== undefined) query.after = after;
        const messages = await ctx.api.listMessages(channel_id, query);
        return {
          channel_id,
          message_count: messages.length,
          messages: messages.map(publicMessage),
        };
      }),
  );
}
