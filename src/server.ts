/** McpServer construction and tool registration. */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DiscordApi } from "./discord/endpoints.js";
import { registerApplyBlueprint } from "./tools/apply_blueprint.js";
import { registerCreateChannel } from "./tools/create_channel.js";
import { registerCreateGuild } from "./tools/create_guild.js";
import { registerCreateRole } from "./tools/create_role.js";
import { registerDeleteChannel } from "./tools/delete_channel.js";
import { registerDeleteRole } from "./tools/delete_role.js";
import { registerGetBotInfo } from "./tools/get_bot_info.js";
import { registerGetGuild } from "./tools/get_guild.js";
import { registerListChannels } from "./tools/list_channels.js";
import { registerListGuilds } from "./tools/list_guilds.js";
import { registerListRoles } from "./tools/list_roles.js";
import { registerReorderChannels } from "./tools/reorder_channels.js";
import { registerReorderRoles } from "./tools/reorder_roles.js";
import { registerSetChannelPermissions } from "./tools/set_channel_permissions.js";
import type { ToolContext } from "./tools/shared.js";

export const SERVER_NAME = "discord-provisioner-mcp";
export const SERVER_VERSION = "0.1.0";

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
  // Write - guild
  registerCreateGuild(server, ctx);
  registerApplyBlueprint(server, ctx);
  // Write - pieces
  registerCreateRole(server, ctx);
  registerCreateChannel(server, ctx);
  registerSetChannelPermissions(server, ctx);
  registerReorderChannels(server, ctx);
  registerReorderRoles(server, ctx);
  // Destructive - gated
  registerDeleteChannel(server, ctx);
  registerDeleteRole(server, ctx);

  return server;
}
