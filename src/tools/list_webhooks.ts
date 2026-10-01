import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { isBullhausGuild } from "../config/bullhaus.js";
import {
  errorResult,
  publicWebhook,
  runTool,
  SNOWFLAKE,
  type ToolContext,
} from "./shared.js";

export function registerListWebhooks(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "list_webhooks",
    {
      title: "List webhooks",
      description:
        "List the webhook inventory for the configured BULLHAUS guild, " +
        "optionally restricted to one channel. Returns sanitized metadata " +
        "only -- webhook tokens and execution URLs are never included.",
      inputSchema: {
        guild_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
        channel_id: z
          .string()
          .regex(SNOWFLAKE, "must be a Discord snowflake id")
          .optional()
          .describe("Restrict results to webhooks whose destination is this channel"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ guild_id, channel_id }) =>
      runTool("list_webhooks", async () => {
        if (!isBullhausGuild(guild_id)) {
          return errorResult(
            new Error(
              `Refusing to list webhooks: guild ${guild_id} is not the ` +
                "configured BULLHAUS guild. Webhook management is restricted " +
                "to that guild only.",
            ),
          );
        }

        // Guild-scoped fetch, then optionally filter by channel -- this means
        // the guild restriction holds even when channel_id is supplied,
        // rather than trusting a caller-supplied channel/guild pairing.
        const webhooks = await ctx.api.listGuildWebhooks(guild_id);
        const filtered =
          channel_id !== undefined
            ? webhooks.filter((w) => w.channel_id === channel_id)
            : webhooks;

        return {
          guild_id,
          channel_id: channel_id ?? null,
          webhook_count: filtered.length,
          webhooks: filtered.map(publicWebhook),
        };
      }),
  );
}
