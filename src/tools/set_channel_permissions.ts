import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { namesToBitfield } from "../discord/permissions.js";
import { jsonResult, runTool, SNOWFLAKE, type ToolContext } from "./shared.js";

export function registerSetChannelPermissions(
  server: McpServer,
  ctx: ToolContext,
): void {
  server.registerTool(
    "set_channel_permissions",
    {
      title: "Set channel permissions",
      description:
        "Set the permission overwrite for a role or member on a channel. " +
        "REPLACES any existing overwrite for that target on that channel. " +
        "The standard private-channel pattern: deny VIEW_CHANNEL for the " +
        "guild's @everyone role (target_id = guild id, target_type = role) " +
        "and allow VIEW_CHANNEL for the roles that should see it.",
      inputSchema: {
        channel_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
        target_id: z
          .string()
          .regex(SNOWFLAKE)
          .describe("Role id or member id. The @everyone role id equals the guild id."),
        target_type: z.enum(["role", "member"]),
        allow: z.array(z.string()).default([]),
        deny: z.array(z.string()).default([]),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) =>
      runTool("set_channel_permissions", async () => {
        const payload = {
          type: args.target_type === "role" ? (0 as const) : (1 as const),
          allow: namesToBitfield(args.allow),
          deny: namesToBitfield(args.deny),
        };

        if (ctx.dryRun) {
          return jsonResult({
            dry_run: true,
            note: "DRY_RUN is active; no overwrite was written.",
            would_set_permissions: {
              channel_id: args.channel_id,
              target_id: args.target_id,
              target_type: args.target_type,
              allow: args.allow,
              deny: args.deny,
            },
          });
        }

        await ctx.api.setChannelPermission(
          args.channel_id,
          args.target_id,
          payload,
          `discord-provisioner-mcp: set ${args.target_type} overwrite on channel`,
        );
        return {
          channel_id: args.channel_id,
          target_id: args.target_id,
          target_type: args.target_type,
          allow: args.allow,
          deny: args.deny,
          note: "Overwrite replaced (PUT semantics).",
        };
      }),
  );
}
