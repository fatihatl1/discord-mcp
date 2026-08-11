import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CHANNEL_TYPE } from "../discord/types.js";
import {
  publicChannel,
  runTool,
  SNOWFLAKE,
  type ToolContext,
} from "./shared.js";

export function registerListChannels(
  server: McpServer,
  ctx: ToolContext,
): void {
  server.registerTool(
    "list_channels",
    {
      title: "List channels",
      description:
        "List every channel in a guild, including categories, with " +
        "permission overwrites decoded to permission names.",
      inputSchema: {
        guild_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ guild_id }) =>
      runTool("list_channels", async () => {
        const channels = await ctx.api.listGuildChannels(guild_id);
        const categoryNames = new Map<string, string>();
        for (const c of channels) {
          if (c.type === CHANNEL_TYPE.GUILD_CATEGORY) {
            categoryNames.set(c.id, c.name ?? "");
          }
        }
        const sorted = [...channels].sort((a, b) => {
          const ap = a.parent_id ?? (a.type === CHANNEL_TYPE.GUILD_CATEGORY ? a.id : "");
          const bp = b.parent_id ?? (b.type === CHANNEL_TYPE.GUILD_CATEGORY ? b.id : "");
          if (ap !== bp) return ap.localeCompare(bp);
          return (a.position ?? 0) - (b.position ?? 0);
        });
        return {
          channel_count: channels.length,
          channels: sorted.map((c) => publicChannel(c, categoryNames)),
        };
      }),
  );
}
