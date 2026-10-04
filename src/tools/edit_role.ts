import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DiscordAPIError } from "../discord/client.js";
import type { ModifyRolePayload } from "../discord/endpoints.js";
import {
  errorResult,
  jsonResult,
  publicRole,
  runTool,
  SNOWFLAKE,
  ToolSafetyError,
  type ToolContext,
} from "./shared.js";
import { assertRoleMutationAllowed, loadRoleAndHierarchy } from "./role_safety.js";

export function registerEditRole(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "edit_role",
    {
      title: "Edit role",
      description:
        "PATCH an existing role's safe properties (name, color, hoist, " +
        "mentionable) in place by id. Never touches permissions -- use " +
        "edit_role_permissions for that. Same hierarchy and self-role " +
        "safety checks as edit_role_permissions. dry_run defaults to true.",
      inputSchema: {
        guild_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
        role_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
        name: z.string().min(1).max(100).optional(),
        color: z
          .string()
          .regex(/^#?[0-9a-fA-F]{6}$/, 'hex color like "#e74c3c"')
          .optional(),
        hoist: z.boolean().optional(),
        mentionable: z.boolean().optional(),
        dry_run: z.boolean().default(true),
        reason: z.string().max(512).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) =>
      runTool("edit_role", async () => {
        const payload: ModifyRolePayload = {};
        if (args.name !== undefined) payload.name = args.name;
        if (args.color !== undefined) {
          payload.color = parseInt(args.color.replace(/^#/, ""), 16);
        }
        if (args.hoist !== undefined) payload.hoist = args.hoist;
        if (args.mentionable !== undefined) payload.mentionable = args.mentionable;

        if (Object.keys(payload).length === 0) {
          return errorResult(
            new Error(
              "edit_role requires at least one of name, color, hoist, " +
                "mentionable to change.",
            ),
          );
        }

        const { role, hierarchy } = await loadRoleAndHierarchy(
          ctx.api,
          args.guild_id,
          args.role_id,
        );
        assertRoleMutationAllowed(hierarchy, role);

        const before = {
          name: role.name,
          color: `#${role.color.toString(16).padStart(6, "0")}`,
          hoist: role.hoist,
          mentionable: role.mentionable,
        };
        const after = { ...before };
        if (args.name !== undefined) after.name = args.name;
        if (args.color !== undefined) {
          after.color = `#${args.color.replace(/^#/, "").toLowerCase()}`;
        }
        if (args.hoist !== undefined) after.hoist = args.hoist;
        if (args.mentionable !== undefined) after.mentionable = args.mentionable;

        const effectiveDryRun = args.dry_run || ctx.dryRun;
        if (effectiveDryRun) {
          return jsonResult({
            dry_run: true,
            forced_by_env: !args.dry_run && ctx.dryRun,
            note:
              "DRY_RUN preview; no PATCH was sent to Discord." +
              (role.managed
                ? " This role is integration-managed: Discord may still " +
                  "reject the real PATCH even though hierarchy allows it."
                : ""),
            guild_id: args.guild_id,
            role_id: args.role_id,
            managed: role.managed,
            before,
            requested_change: payload,
            after,
          });
        }

        const reason =
          args.reason ?? `discord-provisioner-mcp: edit role "${role.name}"`;

        let updated;
        try {
          updated = await ctx.api.modifyRole(
            args.guild_id,
            args.role_id,
            payload,
            reason,
          );
        } catch (err) {
          if (role.managed && err instanceof DiscordAPIError) {
            return errorResult(
              new ToolSafetyError(
                "DISCORD_REJECTED_MANAGED_ROLE_EDIT",
                `Discord rejected this PATCH because role ${role.id} ` +
                  `("${role.name}") is integration-managed: ${err.discordMessage}`,
                {
                  guild_id: args.guild_id,
                  role_id: args.role_id,
                  discord_status: err.status,
                  discord_code: err.code ?? null,
                  discord_message: err.discordMessage,
                },
              ),
            );
          }
          throw err;
        }

        return {
          operation: "edit_role",
          dry_run: false,
          guild_id: args.guild_id,
          role_id: args.role_id,
          before,
          requested_change: payload,
          role: publicRole(updated),
        };
      }),
  );
}
