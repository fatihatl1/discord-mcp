import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runTool, type ToolContext } from "./shared.js";

export function registerListGuilds(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "list_guilds",
    {
      title: "List guilds",
      description:
        "List every guild (server) the bot is currently a member of.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      runTool("list_guilds", async () => {
        const guilds = await ctx.api.listCurrentUserGuilds();
        return {
          guild_count: guilds.length,
          guilds: guilds.map((g) => ({
            id: g.id,
            name: g.name,
            bot_is_owner: g.owner ?? false,
          })),
        };
      }),
  );
}
