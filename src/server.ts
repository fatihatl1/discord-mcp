/** McpServer construction and tool/resource/prompt registration. */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DESIGN_GUIDE, DESIGN_GUIDE_URI } from "./blueprint/design_guide.js";
import { TEMPLATES } from "./blueprint/templates.js";
import type { DiscordApi } from "./discord/endpoints.js";
import { registerApplyBlueprint } from "./tools/apply_blueprint.js";
import { registerCreateChannel } from "./tools/create_channel.js";
import { registerCreateGuild } from "./tools/create_guild.js";
import { registerCreateRole } from "./tools/create_role.js";
import { registerCreateWebhook } from "./tools/create_webhook.js";
import { registerDeleteChannel } from "./tools/delete_channel.js";
import { registerDeleteMessage } from "./tools/delete_message.js";
import { registerDeleteRole } from "./tools/delete_role.js";
import { registerDeleteWebhook } from "./tools/delete_webhook.js";
import { registerEditChannel } from "./tools/edit_channel.js";
import { registerEditMessage } from "./tools/edit_message.js";
import { registerEditRole } from "./tools/edit_role.js";
import { registerEditRolePermissions } from "./tools/edit_role_permissions.js";
import { registerEditRolePosition } from "./tools/edit_role_position.js";
import { registerGetBlueprintTemplate } from "./tools/get_blueprint_template.js";
import { registerGetBotInfo } from "./tools/get_bot_info.js";
import { registerGetEffectivePermissions } from "./tools/get_effective_permissions.js";
import { registerGetGuild } from "./tools/get_guild.js";
import { registerGetMember } from "./tools/get_member.js";
import { registerGetRole } from "./tools/get_role.js";
import { registerListChannels } from "./tools/list_channels.js";
import { registerListGuilds } from "./tools/list_guilds.js";
import { registerListMessages } from "./tools/list_messages.js";
import { registerListRoleMembers } from "./tools/list_role_members.js";
import { registerListRoles } from "./tools/list_roles.js";
import { registerListWebhooks } from "./tools/list_webhooks.js";
import { registerPinMessage } from "./tools/pin_message.js";
import { registerReorderChannels } from "./tools/reorder_channels.js";
import { registerReorderRoles } from "./tools/reorder_roles.js";
import { registerSendMessage } from "./tools/send_message.js";
import { registerSetChannelPermissions } from "./tools/set_channel_permissions.js";
import type { ToolContext } from "./tools/shared.js";
import { registerUnpinMessage } from "./tools/unpin_message.js";

export const SERVER_NAME = "discord-provisioner-mcp";
export const SERVER_VERSION = "0.2.0";

export interface BuildServerOptions {
  api: DiscordApi;
  dryRun: boolean;
}

export function buildServer(opts: BuildServerOptions): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  const ctx: ToolContext = { api: opts.api, dryRun: opts.dryRun };

  // Read
  registerListGuilds(server, ctx);
  registerGetGuild(server, ctx);
  registerListChannels(server, ctx);
  registerListRoles(server, ctx);
  registerGetBotInfo(server, ctx);
  registerGetBlueprintTemplate(server, ctx);
  // Write - guild
  registerCreateGuild(server, ctx);
  registerApplyBlueprint(server, ctx);
  // Write - pieces
  registerCreateRole(server, ctx);
  registerCreateChannel(server, ctx);
  registerEditChannel(server, ctx);
  registerSetChannelPermissions(server, ctx);
  registerReorderChannels(server, ctx);
  registerReorderRoles(server, ctx);
  // Content - messages
  registerSendMessage(server, ctx);
  registerListMessages(server, ctx);
  registerEditMessage(server, ctx);
  registerPinMessage(server, ctx);
  registerUnpinMessage(server, ctx);
  registerDeleteMessage(server, ctx);
  // Webhooks - restricted to the configured BULLHAUS guild
  registerListWebhooks(server, ctx);
  registerCreateWebhook(server, ctx);
  registerDeleteWebhook(server, ctx);
  // Destructive - gated
  registerDeleteChannel(server, ctx);
  registerDeleteRole(server, ctx);
  // Roles & members - direct by-id tooling (hierarchy/self-role/managed-role safe)
  registerGetRole(server, ctx);
  registerEditRolePermissions(server, ctx);
  registerEditRole(server, ctx);
  registerEditRolePosition(server, ctx);
  registerGetMember(server, ctx);
  registerListRoleMembers(server, ctx);
  registerGetEffectivePermissions(server, ctx);

  // Design knowledge: the guide as a readable resource, plus a prompt that
  // packages guide + template into one designing flow.
  server.registerResource(
    "design-guide",
    DESIGN_GUIDE_URI,
    {
      title: "Discord server design guide",
      description:
        "Conventions for laying out roles, categories, channels, and " +
        "permissions in a well-run Discord server",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [
        { uri: uri.href, mimeType: "text/markdown", text: DESIGN_GUIDE },
      ],
    }),
  );

  server.registerPrompt(
    "design_server",
    {
      title: "Design a Discord server",
      description:
        "Compose a server blueprint following the design guide, starting " +
        "from a template when one fits",
      argsSchema: {
        community_type: z
          .string()
          .optional()
          .describe("gaming | dev | support | creator, or anything else"),
        requirements: z
          .string()
          .optional()
          .describe("What the server is for; special roles/channels wanted"),
      },
    },
    ({ community_type, requirements }) => {
      const template = community_type
        ? TEMPLATES[community_type]
        : undefined;
      const parts = [
        "Design a Discord server blueprint for the apply_blueprint tool.",
        `Follow this design guide:\n\n${DESIGN_GUIDE}`,
      ];
      if (template) {
        parts.push(
          `Start from this ${community_type} template and tailor it:\n\n` +
            JSON.stringify(template, null, 2),
        );
      } else {
        parts.push(
          "Check get_blueprint_template for a starting point before " +
            "designing from scratch.",
        );
      }
      if (requirements) {
        parts.push(`Requirements from the user:\n${requirements}`);
      }
      parts.push(
        "Process: tailor the blueprint, run apply_blueprint with " +
          "dry_run: true, show the plan, and only apply after review.",
      );
      return {
        messages: [
          {
            role: "user" as const,
            content: { type: "text" as const, text: parts.join("\n\n") },
          },
        ],
      };
    },
  );

  return server;
}
