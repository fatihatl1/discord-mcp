import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  jsonResult,
  publicRole,
  runTool,
  SNOWFLAKE,
  type ToolContext,
} from "./shared.js";

export function registerReorderRoles(
  server: McpServer,
  ctx: ToolContext,
): void {
  server.registerTool(
    "reorder_roles",
    {
      title: "Reorder roles",
      description:
        "Change the positions of multiple roles in one request. Higher " +
        "position = higher in the role list. The bot can only move roles " +
        "below its own highest role.",
      inputSchema: {
        guild_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
        positions: z
          .array(
            z.object({
              role_id: z.string().regex(SNOWFLAKE),
              position: z.number().int().min(1),
            }),
          )
          .min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ guild_id, positions }) =>
      runTool("reorder_roles", async () => {
        if (ctx.dryRun) {
          return jsonResult({
            dry_run: true,
            note: "DRY_RUN is active; no roles were moved.",
            would_reorder: { guild_id, positions },
          });
        }
        const roles = await ctx.api.modifyRolePositions(
          guild_id,
          positions.map((p) => ({ id: p.role_id, position: p.position })),
          "discord-provisioner-mcp: reorder roles",
        );
        return {
          roles: [...roles]
            .sort((a, b) => b.position - a.position)
            .map(publicRole),
        };
      }),
  );
}
