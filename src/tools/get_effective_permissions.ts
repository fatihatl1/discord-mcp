import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DiscordAPIError } from "../discord/client.js";
import {
  computeEffectivePermissions,
} from "../discord/effective_permissions.js";
import { CHANNEL_TYPE } from "../discord/types.js";
import {
  errorResult,
  runTool,
  SNOWFLAKE,
  ToolSafetyError,
  type ToolContext,
} from "./shared.js";

export function registerGetEffectivePermissions(
  server: McpServer,
  ctx: ToolContext,
): void {
  server.registerTool(
    "get_effective_permissions",
    {
      title: "Get effective permissions",
      description:
        "Calculate effective Discord permissions for either a real guild " +
        "member (user_id) or a hypothetical role set (role_ids), " +
        "server-wide and, optionally, inside one channel. Accounts for " +
        "@everyone, held roles, ADMINISTRATOR bypass, category overwrites, " +
        "channel overwrites, and (in user_id mode) member-specific " +
        "overwrites -- following Discord's documented precedence. Returns " +
        "the contributing roles and a step-by-step reasoning trace. " +
        "READ ONLY.",
      inputSchema: {
        guild_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
        user_id: z
          .string()
          .regex(SNOWFLAKE)
          .optional()
          .describe("Evaluate this real member. Mutually exclusive with role_ids."),
        role_ids: z
          .array(z.string().regex(SNOWFLAKE))
          .optional()
          .describe(
            "Evaluate this hypothetical role set instead of a real member " +
              "(@everyone is always included implicitly). Mutually exclusive with user_id.",
          ),
        channel_id: z
          .string()
          .regex(SNOWFLAKE)
          .optional()
          .describe("Also compute channel-level permissions in this channel"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ guild_id, user_id, role_ids, channel_id }) =>
      runTool("get_effective_permissions", async () => {
        if ((user_id === undefined) === (role_ids === undefined)) {
          return errorResult(
            new Error(
              "Supply exactly one of `user_id` (real member) or `role_ids` " +
                "(hypothetical role set), not both and not neither.",
            ),
          );
        }

        const roles = await ctx.api.listGuildRoles(guild_id);

        let memberRoleIds: string[];
        let memberId: string | undefined;
        let memberSummary: Record<string, unknown> | undefined;

        if (user_id !== undefined) {
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
          memberRoleIds = member.roles;
          memberId = user_id;
          memberSummary = { user_id, nickname: member.nick ?? null };
        } else {
          const knownIds = new Set(roles.map((r) => r.id));
          const unknown = (role_ids ?? []).filter((id) => !knownIds.has(id));
          memberRoleIds = (role_ids ?? []).filter((id) => knownIds.has(id));
          memberSummary = {
            role_ids_evaluated: memberRoleIds,
            ...(unknown.length > 0 ? { unknown_role_ids_ignored: unknown } : {}),
          };
        }

        let channel;
        let category;
        if (channel_id !== undefined) {
          const channels = await ctx.api.listGuildChannels(guild_id);
          const found = channels.find((c) => c.id === channel_id);
          if (!found) {
            return errorResult(
              new ToolSafetyError(
                "CHANNEL_NOT_FOUND",
                `No channel with id ${channel_id} in guild ${guild_id}.`,
                { guild_id, channel_id },
              ),
            );
          }
          if (found.type === CHANNEL_TYPE.GUILD_CATEGORY) {
            return errorResult(
              new Error(
                "channel_id must be a non-category channel; categories " +
                  "have no member-specific overwrites of their own to layer. " +
                  "Pass the channel whose effective permissions you want " +
                  "(its category overwrites are applied automatically).",
              ),
            );
          }
          channel = found;
          if (found.parent_id) {
            category = channels.find((c) => c.id === found.parent_id);
          }
        }

        const result = computeEffectivePermissions({
          roles,
          everyoneRoleId: guild_id,
          roleIds: memberRoleIds,
          memberId,
          channel,
          category,
        });

        return {
          guild_id,
          channel_id: channel_id ?? null,
          ...memberSummary,
          administrator: result.administrator,
          server_permissions: result.server_permissions,
          channel_permissions: result.channel_permissions,
          contributing_roles: result.contributing_roles,
          reasoning: result.reasoning,
        };
      }),
  );
}
