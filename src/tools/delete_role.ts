import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorResult, jsonResult, runTool, SNOWFLAKE, type ToolContext } from "./shared.js";

export function registerDeleteRole(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "delete_role",
    {
      title: "Delete role (IRREVERSIBLE)",
      description:
        "Permanently delete a role from a guild. THIS IS IRREVERSIBLE: the " +
        "role is removed from every member and every permission overwrite. " +
        "Requires confirm=true as an explicit acknowledgement.",
      inputSchema: {
        guild_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
        role_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
        confirm: z
          .boolean()
          .describe("Must be true. Confirms you understand this is irreversible."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ guild_id, role_id, confirm }) =>
      runTool("delete_role", async () => {
        if (confirm !== true) {
          return errorResult(
            new Error(
              "Refusing to delete: confirm=true is required. Deleting a " +
                "role is irreversible.",
            ),
          );
        }
        if (ctx.dryRun) {
          return jsonResult({
            dry_run: true,
            note: "DRY_RUN is active; no role was deleted.",
            would_delete_role: { guild_id, role_id },
          });
        }
        await ctx.api.deleteRole(
          guild_id,
          role_id,
          "discord-provisioner-mcp: delete role (confirmed by operator)",
        );
        return {
          deleted: { guild_id, role_id },
          note: "Role permanently deleted.",
        };
      }),
  );
}
