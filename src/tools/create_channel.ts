import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CreateChannelPayload } from "../discord/endpoints.js";
import { namesToBitfield } from "../discord/permissions.js";
import { CHANNEL_TYPE_BY_NAME } from "../discord/types.js";
import {
  jsonResult,
  publicChannel,
  runTool,
  SNOWFLAKE,
  type ToolContext,
} from "./shared.js";

const OverwriteInput = z.object({
  target_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
  target_type: z.enum(["role", "member"]),
  allow: z.array(z.string()).default([]),
  deny: z.array(z.string()).default([]),
});

export function registerCreateChannel(
  server: McpServer,
  ctx: ToolContext,
): void {
  server.registerTool(
    "create_channel",
    {
      title: "Create channel",
      description:
        "Create a channel (or category) in a guild. Overwrite permissions " +
        "are given as permission names.",
      inputSchema: {
        guild_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
        name: z.string().min(1).max(100),
        type: z
          .enum(["text", "voice", "category", "announcement", "stage", "forum", "media"])
          .default("text"),
        parent_id: z
          .string()
          .regex(SNOWFLAKE)
          .optional()
          .describe("Category channel id to place this channel under"),
        topic: z.string().max(4096).optional(),
        nsfw: z.boolean().optional(),
        rate_limit_per_user: z.number().int().min(0).max(21600).optional(),
        position: z.number().int().min(0).optional(),
        permission_overwrites: z.array(OverwriteInput).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) =>
      runTool("create_channel", async () => {
        const payload: CreateChannelPayload = {
          name: args.name,
          type: CHANNEL_TYPE_BY_NAME[args.type],
        };
        if (args.parent_id !== undefined) payload.parent_id = args.parent_id;
        if (args.topic !== undefined) payload.topic = args.topic;
        if (args.nsfw !== undefined) payload.nsfw = args.nsfw;
        if (args.rate_limit_per_user !== undefined) {
          payload.rate_limit_per_user = args.rate_limit_per_user;
        }
        if (args.position !== undefined) payload.position = args.position;
        if (args.permission_overwrites) {
          payload.permission_overwrites = args.permission_overwrites.map(
            (ow) => ({
              id: ow.target_id,
              type: ow.target_type === "role" ? (0 as const) : (1 as const),
              allow: namesToBitfield(ow.allow),
              deny: namesToBitfield(ow.deny),
            }),
          );
        }

        if (ctx.dryRun) {
          return jsonResult({
            dry_run: true,
            note: "DRY_RUN is active; no channel was created.",
            would_create_channel: { guild_id: args.guild_id, ...payload },
          });
        }

        const channel = await ctx.api.createChannel(
          args.guild_id,
          payload,
          `discord-provisioner-mcp: create ${args.type} channel "${args.name}"`,
        );
        return { channel: publicChannel(channel) };
      }),
  );
}
