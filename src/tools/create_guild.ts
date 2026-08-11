import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildGuildCreatePayload } from "../blueprint/apply.js";
import {
  BlueprintObjectSchema,
  validateBlueprint,
} from "../blueprint/schema.js";
import { BOT_GUILD_CREATE_LIMIT } from "./get_bot_info.js";
import { errorResult, jsonResult, runTool, type ToolContext } from "./shared.js";

export function registerCreateGuild(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "create_guild",
    {
      title: "Create guild",
      description:
        "Create a new guild (server) owned by the bot, optionally " +
        "provisioning the entire structure (roles, categories, channels, " +
        "permission overwrites) from a blueprint in a single request. Only " +
        "works while the bot is in fewer than 10 guilds; otherwise create " +
        "the server manually, invite the bot, and use apply_blueprint.",
      inputSchema: {
        name: z.string().min(2).max(100),
        blueprint: BlueprintObjectSchema.optional().describe(
          "Optional blueprint; its name field is overridden by the name parameter",
        ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ name, blueprint }) =>
      runTool("create_guild", async () => {
        const payload = blueprint
          ? buildGuildCreatePayload(validateBlueprint({ ...blueprint, name }))
          : { name };

        if (ctx.dryRun) {
          return jsonResult({
            dry_run: true,
            note: "DRY_RUN is active; no guild was created.",
            would_create_guild: payload,
          });
        }

        const guilds = await ctx.api.listCurrentUserGuilds();
        if (guilds.length >= BOT_GUILD_CREATE_LIMIT) {
          return errorResult(
            new Error(
              `Bot is in ${guilds.length} guilds; Discord only allows bots ` +
                `to create guilds while they are in fewer than ` +
                `${BOT_GUILD_CREATE_LIMIT}. Create the server manually in ` +
                `the Discord app, invite the bot using the OAuth2 URL from ` +
                `the README, then run apply_blueprint against it.`,
            ),
          );
        }

        const guild = await ctx.api.createGuild(payload);
        return {
          guild: { id: guild.id, name: guild.name },
          note:
            "Guild created with the bot as owner. Bot-created guilds have no " +
            "human members until people are invited; use get_guild / " +
            "list_channels to inspect the result.",
        };
      }),
  );
}
