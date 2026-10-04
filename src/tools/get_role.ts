import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { publicRole, runTool, SNOWFLAKE, ToolSafetyError, type ToolContext } from "./shared.js";

export function registerGetRole(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_role",
    {
      title: "Get role",
      description:
        "Fetch one role in a guild by id: name, position, color, hoist, " +
        "mentionable, managed status, decoded permission names, and " +
        "integration tags if present. READ ONLY.",
      inputSchema: {
        guild_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
        role_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ guild_id, role_id }) =>
      runTool("get_role", async () => {
        const roles = await ctx.api.listGuildRoles(guild_id);
        const role = roles.find((r) => r.id === role_id);
        if (!role) {
          throw new ToolSafetyError(
            "ROLE_NOT_FOUND",
            `No role with id ${role_id} exists in guild ${guild_id}.`,
            { guild_id, role_id },
          );
        }
        return { role: publicRole(role) };
      }),
  );
}
