import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jsonResult, runTool, SNOWFLAKE, type ToolContext } from "./shared.js";

export function registerReorderChannels(
  server: McpServer,
  ctx: ToolContext,
): void {
  server.registerTool(
    "reorder_channels",
    {
      title: "Reorder channels",
      description:
        "Change the positions (and optionally the parent category) of " +
        "multiple channels in one request. Positions are relative within " +
        "each channel group (categories, text-like, voice).",
      inputSchema: {
        guild_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
        positions: z
          .array(
            z.object({
              channel_id: z.string().regex(SNOWFLAKE),
              position: z.number().int().min(0),
              parent_id: z
                .string()
                .regex(SNOWFLAKE)
                .nullable()
                .optional()
                .describe("Move under this category (null = top level)"),
              lock_permissions: z
                .boolean()
                .optional()
                .describe("Sync overwrites with the new parent category"),
            }),
          )
          .min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ guild_id, positions }) =>
      runTool("reorder_channels", async () => {
        if (ctx.dryRun) {
          return jsonResult({
            dry_run: true,
            note: "DRY_RUN is active; no channels were moved.",
            would_reorder: { guild_id, positions },
          });
        }
        await ctx.api.modifyChannelPositions(
          guild_id,
          positions.map((p) => ({
            id: p.channel_id,
            position: p.position,
            ...(p.parent_id !== undefined ? { parent_id: p.parent_id } : {}),
            ...(p.lock_permissions !== undefined
              ? { lock_permissions: p.lock_permissions }
              : {}),
          })),
          "discord-provisioner-mcp: reorder channels",
        );
        return { reordered: positions.length };
      }),
  );
}
