import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DiscordAPIError } from "../discord/client.js";
import {
  errorResult,
  publicMember,
  runTool,
  SNOWFLAKE,
  ToolSafetyError,
  type ToolContext,
} from "./shared.js";

export function registerGetMember(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_member",
    {
      title: "Get member",
      description:
        "Fetch one guild member by user id: user id/username, bot flag, " +
        "nickname, joined_at, and both role ids and resolved role names. " +
        "READ ONLY. Unlike list_role_members, this does not need the " +
        "privileged GUILD_MEMBERS intent.",
      inputSchema: {
        guild_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
        user_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ guild_id, user_id }) =>
      runTool("get_member", async () => {
        let member;
        try {
          member = await ctx.api.getGuildMember(guild_id, user_id);
        } catch (err) {
          if (err instanceof DiscordAPIError && err.status === 404) {
            return errorResult(
              new ToolSafetyError(
                "MEMBER_NOT_FOUND",
                `No member with user id ${user_id} in guild ${guild_id}.`,
                { guild_id, user_id },
              ),
            );
          }
          throw err;
        }
        const roles = await ctx.api.listGuildRoles(guild_id);
        const roleNameById = new Map(roles.map((r) => [r.id, r.name]));
        return { member: publicMember(member, roleNameById) };
      }),
  );
}
