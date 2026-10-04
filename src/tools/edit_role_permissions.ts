import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ModifyRolePayload } from "../discord/endpoints.js";
import { DiscordAPIError } from "../discord/client.js";
import {
  PERMISSIONS,
  bitfieldToNames,
  namesToBits,
  parseBitfield,
} from "../discord/permissions.js";
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

export function registerEditRolePermissions(
  server: McpServer,
  ctx: ToolContext,
): void {
  server.registerTool(
    "edit_role_permissions",
    {
      title: "Edit role permissions",
      description:
        "PATCH an existing role's permission bitfield in place by id -- " +
        "never create_role, never a replacement role, never apply_blueprint. " +
        "Supply EITHER `permissions` (exact replacement) OR `add_permissions` " +
        "/ `remove_permissions` (incremental), not both. Refuses to add " +
        "ADMINISTRATOR unless allow_administrator=true is explicitly passed " +
        "(removing it needs no such flag). Checked before any write: role " +
        "exists, role hierarchy (the bot can only manage roles strictly " +
        "below its own highest role), and self-role protection (the bot " +
        "will not edit its own managed integration role). dry_run defaults " +
        "to true and returns a before/after preview with zero Discord writes.",
      inputSchema: {
        guild_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
        role_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
        permissions: z
          .array(z.string())
          .optional()
          .describe("Exact replacement permission set, as permission names"),
        add_permissions: z
          .array(z.string())
          .optional()
          .describe("Permission names to add to the role's current set"),
        remove_permissions: z
          .array(z.string())
          .optional()
          .describe("Permission names to remove from the role's current set"),
        allow_administrator: z
          .boolean()
          .default(false)
          .describe("Must be true to let this call ADD the ADMINISTRATOR permission"),
        dry_run: z.boolean().default(true),
        reason: z.string().max(512).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) =>
      runTool("edit_role_permissions", async () => {
        const hasExact = args.permissions !== undefined;
        const hasIncremental =
          args.add_permissions !== undefined || args.remove_permissions !== undefined;
        if (hasExact && hasIncremental) {
          return errorResult(
            new Error(
              "Supply either `permissions` (exact replacement) or " +
                "`add_permissions`/`remove_permissions` (incremental), not both.",
            ),
          );
        }
        if (!hasExact && !hasIncremental) {
          return errorResult(
            new Error(
              "Nothing to change: supply `permissions`, or at least one of " +
                "`add_permissions`/`remove_permissions`.",
            ),
          );
        }

        const { role, hierarchy } = await loadRoleAndHierarchy(
          ctx.api,
          args.guild_id,
          args.role_id,
        );
        assertRoleMutationAllowed(hierarchy, role);

        const currentBits = parseBitfield(role.permissions);
        const targetBits = hasExact
          ? namesToBits(args.permissions ?? [])
          : (currentBits | namesToBits(args.add_permissions ?? [])) &
            ~namesToBits(args.remove_permissions ?? []);

        const addedBits = targetBits & ~currentBits;
        const removedBits = currentBits & ~targetBits;

        if (
          (addedBits & PERMISSIONS.ADMINISTRATOR) === PERMISSIONS.ADMINISTRATOR &&
          !args.allow_administrator
        ) {
          return errorResult(
            new ToolSafetyError(
              "ADMINISTRATOR_OPT_IN_REQUIRED",
              "Refusing to add ADMINISTRATOR to this role: pass " +
                "allow_administrator=true to explicitly confirm this is " +
                "intended. Removing ADMINISTRATOR never requires this flag.",
              { guild_id: args.guild_id, role_id: args.role_id },
            ),
          );
        }

        const administratorAfter =
          (targetBits & PERMISSIONS.ADMINISTRATOR) === PERMISSIONS.ADMINISTRATOR;

        const preview = {
          guild_id: args.guild_id,
          role_id: args.role_id,
          role_name: role.name,
          managed: role.managed,
          permissions_before: bitfieldToNames(currentBits.toString()),
          permissions_added: bitfieldToNames(addedBits.toString()),
          permissions_removed: bitfieldToNames(removedBits.toString()),
          permissions_after: bitfieldToNames(targetBits.toString()),
          administrator_after: administratorAfter,
        };

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
            ...preview,
          });
        }

        const payload: ModifyRolePayload = {
          permissions: targetBits.toString(),
        };
        const reason =
          args.reason ?? `discord-provisioner-mcp: edit permissions on role "${role.name}"`;

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
          operation: "edit_role_permissions",
          dry_run: false,
          ...preview,
          role: publicRole(updated),
        };
      }),
  );
}
