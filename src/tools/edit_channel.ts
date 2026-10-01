import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ModifyChannelPayload } from "../discord/endpoints.js";
import {
  errorResult,
  jsonResult,
  publicChannel,
  runTool,
  SNOWFLAKE,
  type ToolContext,
} from "./shared.js";

export function registerEditChannel(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "edit_channel",
    {
      title: "Edit channel",
      description:
        "Modify an existing channel in place by id (PATCH semantics). " +
        "This never creates a replacement channel -- only the fields you " +
        "provide are changed; everything else on the channel is left as-is.",
      inputSchema: {
        channel_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
        name: z.string().min(1).max(100).optional(),
        topic: z.string().max(4096).optional(),
        nsfw: z.boolean().optional(),
        rate_limit_per_user: z.number().int().min(0).max(21600).optional(),
        bitrate: z
          .number()
          .int()
          .min(8000)
          .max(384000)
          .optional()
          .describe("Voice channels only, in bits per second"),
        user_limit: z
          .number()
          .int()
          .min(0)
          .max(99)
          .optional()
          .describe("Voice channels only; 0 = unlimited"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) =>
      runTool("edit_channel", async () => {
        const payload: ModifyChannelPayload = {};
        if (args.name !== undefined) payload.name = args.name;
        if (args.topic !== undefined) payload.topic = args.topic;
        if (args.nsfw !== undefined) payload.nsfw = args.nsfw;
        if (args.rate_limit_per_user !== undefined) {
          payload.rate_limit_per_user = args.rate_limit_per_user;
        }
        if (args.bitrate !== undefined) payload.bitrate = args.bitrate;
        if (args.user_limit !== undefined) payload.user_limit = args.user_limit;

        if (Object.keys(payload).length === 0) {
          return errorResult(
            new Error(
              "edit_channel requires at least one optional field to change " +
                "(name, topic, nsfw, rate_limit_per_user, bitrate, user_limit).",
            ),
          );
        }

        if (ctx.dryRun) {
          return jsonResult({
            dry_run: true,
            note: "DRY_RUN is active; no channel was modified.",
            would_edit_channel: { channel_id: args.channel_id, ...payload },
          });
        }

        const channel = await ctx.api.modifyChannel(
          args.channel_id,
          payload,
          "discord-provisioner-mcp: edit channel",
        );
        return { channel: publicChannel(channel) };
      }),
  );
}
