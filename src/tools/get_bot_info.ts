import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runTool, type ToolContext } from "./shared.js";

/** Bots can only create guilds while they are in fewer than 10. */
export const BOT_GUILD_CREATE_LIMIT = 10;

export function registerGetBotInfo(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_bot_info",
    {
      title: "Get bot info",
      description:
        "Show the bot's identity, how many guilds it is in, and whether it " +
        "is still under the 10-guild limit that gates guild creation.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      runTool("get_bot_info", async () => {
        const [user, guilds] = await Promise.all([
          ctx.api.getCurrentUser(),
          ctx.api.listCurrentUserGuilds(),
        ]);
        const canCreate = guilds.length < BOT_GUILD_CREATE_LIMIT;
        return {
          user: {
            id: user.id,
            username: user.username,
            global_name: user.global_name ?? null,
            bot: user.bot ?? true,
          },
          guild_count: guilds.length,
          can_create_guilds: canCreate,
          note: canCreate
            ? `Bot is in ${guilds.length} guild(s); create_guild is available ` +
              `while under ${BOT_GUILD_CREATE_LIMIT}.`
            : `Bot is in ${guilds.length} guilds; Discord blocks guild ` +
              `creation for bots in ${BOT_GUILD_CREATE_LIMIT}+ guilds. Create ` +
              `the server manually, invite the bot, then use apply_blueprint.`,
        };
      }),
  );
}
