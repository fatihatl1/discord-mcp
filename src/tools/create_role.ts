import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { namesToBitfield } from "../discord/permissions.js";
import {
  jsonResult,
  publicRole,
  runTool,
  SNOWFLAKE,
  type ToolContext,
} from "./shared.js";

export function registerCreateRole(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "create_role",
    {
      title: "Create role",
      description:
        "Create a role in a guild. Permissions are given as permission " +
        "names (e.g. VIEW_CHANNEL, SEND_MESSAGES), never raw bitfields.",
      inputSchema: {
        guild_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
        name: z.string().min(1).max(100),
        permissions: z
          .array(z.string())
          .optional()
          .describe("Permission names, e.g. [\"VIEW_CHANNEL\", \"SEND_MESSAGES\"]"),
        color: z
          .string()
          .regex(/^#?[0-9a-fA-F]{6}$/, 'hex color like "#e74c3c"')
          .optional(),
        hoist: z.boolean().optional(),
        mentionable: z.boolean().optional(),
        position: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Desired position; higher = higher in the role list"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) =>
      runTool("create_role", async () => {
        const payload: {
          name: string;
          permissions?: string;
          color?: number;
          hoist?: boolean;
          mentionable?: boolean;
        } = { name: args.name };
        if (args.permissions) {
          payload.permissions = namesToBitfield(args.permissions);
        }
        if (args.color !== undefined) {
          payload.color = parseInt(args.color.replace(/^#/, ""), 16);
        }
        if (args.hoist !== undefined) payload.hoist = args.hoist;
        if (args.mentionable !== undefined) {
          payload.mentionable = args.mentionable;
        }

        if (ctx.dryRun) {
          return jsonResult({
            dry_run: true,
            note: "DRY_RUN is active; no role was created.",
            would_create_role: { guild_id: args.guild_id, ...payload },
          });
        }

        const role = await ctx.api.createRole(
          args.guild_id,
          payload,
          `discord-provisioner-mcp: create role "${args.name}"`,
        );
        if (args.position !== undefined) {
          await ctx.api.modifyRolePositions(
            args.guild_id,
            [{ id: role.id, position: args.position }],
            `discord-provisioner-mcp: position role "${args.name}"`,
          );
        }
        return { role: publicRole(role) };
      }),
  );
}
