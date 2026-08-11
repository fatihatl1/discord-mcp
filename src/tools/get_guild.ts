import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { publicRole, runTool, SNOWFLAKE, type ToolContext } from "./shared.js";

export function registerGetGuild(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_guild",
    {
      title: "Get guild",
      description:
        "Fetch a guild's settings and full role list (with permission " +
        "bitfields decoded to names).",
      inputSchema: {
        guild_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ guild_id }) =>
      runTool("get_guild", async () => {
        const guild = await ctx.api.getGuild(guild_id);
        const roles = guild.roles ?? (await ctx.api.listGuildRoles(guild_id));
        return {
          guild: {
            id: guild.id,
            name: guild.name,
            owner_id: guild.owner_id,
            verification_level: guild.verification_level ?? null,
            default_message_notifications:
              guild.default_message_notifications ?? null,
            explicit_content_filter: guild.explicit_content_filter ?? null,
            system_channel_id: guild.system_channel_id ?? null,
            afk_channel_id: guild.afk_channel_id ?? null,
            afk_timeout: guild.afk_timeout ?? null,
            approximate_member_count: guild.approximate_member_count ?? null,
          },
          roles: [...roles]
            .sort((a, b) => b.position - a.position)
            .map(publicRole),
        };
      }),
  );
}
