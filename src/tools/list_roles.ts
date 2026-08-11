import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { publicRole, runTool, SNOWFLAKE, type ToolContext } from "./shared.js";

export function registerListRoles(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "list_roles",
    {
      title: "List roles",
      description:
        "List every role in a guild, highest first, with permission " +
        "bitfields decoded to names.",
      inputSchema: {
        guild_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ guild_id }) =>
      runTool("list_roles", async () => {
        const roles = await ctx.api.listGuildRoles(guild_id);
        return {
          role_count: roles.length,
          roles: [...roles]
            .sort((a, b) => b.position - a.position)
            .map(publicRole),
        };
      }),
  );
}
