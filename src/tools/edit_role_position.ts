import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DiscordAPIError } from "../discord/client.js";
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

export function registerEditRolePosition(
  server: McpServer,
  ctx: ToolContext,
): void {
  server.registerTool(
    "edit_role_position",
    {
      title: "Edit role position",
      description:
        "Move a single role to a new position by id (PATCH " +
        "/guilds/{guild}/roles). Higher position = higher in the role list. " +
        "Hierarchy is validated before any write: the bot cannot move " +
        "@everyone, its own managed role, or any role at or above its own " +
        "highest role. dry_run defaults to true and returns a before/after " +
        "position preview with zero Discord writes.",
      inputSchema: {
        guild_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
        role_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
        position: z.number().int().min(1),
        dry_run: z.boolean().default(true),
        reason: z.string().max(512).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) =>
      runTool("edit_role_position", async () => {
        if (args.role_id === args.guild_id) {
          return errorResult(
            new ToolSafetyError(
              "ROLE_HIERARCHY_BLOCKED",
              "Cannot reposition @everyone; Discord always keeps it at " +
                "position 0.",
              { guild_id: args.guild_id, role_id: args.role_id },
            ),
          );
        }

        const { role, hierarchy } = await loadRoleAndHierarchy(
          ctx.api,
          args.guild_id,
          args.role_id,
        );
        assertRoleMutationAllowed(hierarchy, role);

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
            role_name: role.name,
            managed: role.managed,
            position_before: role.position,
            position_requested: args.position,
          });
        }

        const reason =
          args.reason ?? `discord-provisioner-mcp: reposition role "${role.name}"`;

        let updatedRoles;
        try {
          updatedRoles = await ctx.api.modifyRolePositions(
            args.guild_id,
            [{ id: args.role_id, position: args.position }],
            reason,
          );
        } catch (err) {
          if (role.managed && err instanceof DiscordAPIError) {
            return errorResult(
              new ToolSafetyError(
                "DISCORD_REJECTED_MANAGED_ROLE_EDIT",
                `Discord rejected this position change because role ${role.id} ` +
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

        const updated = updatedRoles.find((r) => r.id === args.role_id);
        return {
          operation: "edit_role_position",
          dry_run: false,
          guild_id: args.guild_id,
          role_id: args.role_id,
          position_before: role.position,
          position_after: updated?.position ?? args.position,
          role: updated ? publicRole(updated) : undefined,
        };
      }),
  );
}
