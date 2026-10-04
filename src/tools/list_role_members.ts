import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DiscordAPIError } from "../discord/client.js";
import type { DiscordApi } from "../discord/endpoints.js";
import type { APIGuildMember } from "../discord/types.js";
import {
  errorResult,
  publicMember,
  runTool,
  SNOWFLAKE,
  ToolSafetyError,
  type ToolContext,
} from "./shared.js";

/** Safety cap on pages fetched from Discord (1000 members/page -> 20000 members max). */
const MAX_PAGES = 20;

async function fetchAllMembers(
  api: DiscordApi,
  guildId: string,
): Promise<APIGuildMember[]> {
  const all: APIGuildMember[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await api.listGuildMembers(guildId, { limit: 1000, after });
    all.push(...batch);
    if (batch.length < 1000) break;
    const last = batch[batch.length - 1];
    const lastId = last?.user?.id;
    if (!lastId) break;
    after = lastId;
  }
  return all;
}

export function registerListRoleMembers(
  server: McpServer,
  ctx: ToolContext,
): void {
  server.registerTool(
    "list_role_members",
    {
      title: "List role members",
      description:
        "List every guild member carrying a given role (role_id == guild_id " +
        "matches @everyone, i.e. everyone). READ ONLY. Requires the " +
        "GUILD_MEMBERS privileged intent to be enabled for this bot " +
        "application in the Discord developer portal (Bot tab); confirmed " +
        "live against a real guild without it on, Discord rejects the " +
        "underlying endpoint outright (403, Missing Access) rather than " +
        "returning an empty list -- this tool surfaces that as " +
        "GUILD_MEMBERS_INTENT_REQUIRED. See README.",
      inputSchema: {
        guild_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
        role_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe("Cap on matching members returned. Default: all matches"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ guild_id, role_id, limit }) =>
      runTool("list_role_members", async () => {
        let allMembers: APIGuildMember[];
        try {
          allMembers = await fetchAllMembers(ctx.api, guild_id);
        } catch (err) {
          if (err instanceof DiscordAPIError && (err.status === 403 || err.code === 50001)) {
            return errorResult(
              new ToolSafetyError(
                "GUILD_MEMBERS_INTENT_REQUIRED",
                "Discord rejected GET /guilds/{guild}/members. This almost " +
                  "always means the GUILD_MEMBERS privileged intent is OFF " +
                  "for this bot application -- enable it in the Discord " +
                  "developer portal (your application -> Bot tab -> " +
                  "Privileged Gateway Intents -> Server Members Intent). " +
                  `Discord's error: ${err.discordMessage}`,
                {
                  guild_id,
                  discord_status: err.status,
                  discord_code: err.code ?? null,
                },
              ),
            );
          }
          throw err;
        }

        const roles = await ctx.api.listGuildRoles(guild_id);
        const roleNameById = new Map(roles.map((r) => [r.id, r.name]));

        const everyone = role_id === guild_id;
        const matching = allMembers.filter(
          (m) => everyone || m.roles.includes(role_id),
        );
        const limited = limit !== undefined ? matching.slice(0, limit) : matching;

        return {
          guild_id,
          role_id,
          role_name: roleNameById.get(role_id) ?? (everyone ? "@everyone" : null),
          total_guild_members_scanned: allMembers.length,
          matching_member_count: matching.length,
          returned_member_count: limited.length,
          members: limited.map((m) => publicMember(m, roleNameById)),
        };
      }),
  );
}
