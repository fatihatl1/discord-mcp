/** Typed wrappers for each Discord REST endpoint this server uses. */

import type { DiscordClient } from "./client.js";
import type {
  APIChannel,
  APIGuild,
  APIMessage,
  APIPartialGuild,
  APIRole,
  APIUser,
  APIWebhook,
  OverwriteType,
} from "./types.js";

export interface CreateRolePayload {
  name: string;
  permissions?: string;
  color?: number;
  hoist?: boolean;
  mentionable?: boolean;
}

export interface ModifyRolePayload {
  name?: string;
  permissions?: string;
  color?: number;
  hoist?: boolean;
  mentionable?: boolean;
}

export interface RolePosition {
  id: string;
  position: number;
}

export interface OverwritePayload {
  id: string;
  type: OverwriteType;
  allow: string;
  deny: string;
}

export interface CreateChannelPayload {
  name: string;
  type: number;
  parent_id?: string;
  topic?: string;
  nsfw?: boolean;
  rate_limit_per_user?: number;
  position?: number;
  permission_overwrites?: OverwritePayload[];
}

export interface ModifyChannelPayload {
  name?: string;
  topic?: string | null;
  nsfw?: boolean;
  rate_limit_per_user?: number;
  parent_id?: string | null;
  bitrate?: number;
  user_limit?: number;
  permission_overwrites?: OverwritePayload[];
}

export interface ChannelPosition {
  id: string;
  position: number;
  parent_id?: string | null;
  lock_permissions?: boolean;
}

export interface CreateMessagePayload {
  content: string;
  /** Message flag bitfield, e.g. MESSAGE_FLAGS.SUPPRESS_EMBEDS. */
  flags?: number;
}

export interface CreateWebhookPayload {
  name: string;
}

export interface EditMessagePayload {
  content: string;
}

export interface ListMessagesQuery {
  limit: number;
  before?: string;
  after?: string;
}

/** Role entry in a POST /guilds payload. Ids are integer placeholders. */
export interface GuildCreateRole {
  id: number;
  name: string;
  permissions?: string;
  color?: number;
  hoist?: boolean;
  mentionable?: boolean;
}

/** Channel entry in a POST /guilds payload. Ids are integer placeholders. */
export interface GuildCreateChannel {
  id: number;
  name: string;
  type: number;
  parent_id?: number;
  topic?: string;
  nsfw?: boolean;
  rate_limit_per_user?: number;
  permission_overwrites?: Array<{
    id: number;
    type: 0;
    allow: string;
    deny: string;
  }>;
}

export interface CreateGuildPayload {
  name: string;
  icon?: string;
  verification_level?: number;
  default_message_notifications?: number;
  explicit_content_filter?: number;
  roles?: GuildCreateRole[];
  channels?: GuildCreateChannel[];
  system_channel_id?: number;
  afk_channel_id?: number;
  afk_timeout?: number;
}

/**
 * The surface tools and the blueprint applier depend on. Tests substitute an
 * in-memory fake implementing this interface.
 */
export interface DiscordApi {
  getCurrentUser(): Promise<APIUser>;
  listCurrentUserGuilds(): Promise<APIPartialGuild[]>;
  getGuild(guildId: string): Promise<APIGuild>;
  listGuildChannels(guildId: string): Promise<APIChannel[]>;
  listGuildRoles(guildId: string): Promise<APIRole[]>;
  createGuild(payload: CreateGuildPayload): Promise<APIGuild>;
  createRole(
    guildId: string,
    payload: CreateRolePayload,
    reason: string,
  ): Promise<APIRole>;
  modifyRole(
    guildId: string,
    roleId: string,
    payload: ModifyRolePayload,
    reason: string,
  ): Promise<APIRole>;
  modifyRolePositions(
    guildId: string,
    positions: RolePosition[],
    reason: string,
  ): Promise<APIRole[]>;
  createChannel(
    guildId: string,
    payload: CreateChannelPayload,
    reason: string,
  ): Promise<APIChannel>;
  modifyChannel(
    channelId: string,
    payload: ModifyChannelPayload,
    reason: string,
  ): Promise<APIChannel>;
  modifyChannelPositions(
    guildId: string,
    positions: ChannelPosition[],
    reason: string,
  ): Promise<void>;
  setChannelPermission(
    channelId: string,
    overwriteId: string,
    payload: { type: OverwriteType; allow: string; deny: string },
    reason: string,
  ): Promise<void>;
  deleteChannelPermission(
    channelId: string,
    overwriteId: string,
    reason: string,
  ): Promise<void>;
  deleteChannel(channelId: string, reason: string): Promise<APIChannel>;
  deleteRole(guildId: string, roleId: string, reason: string): Promise<void>;
  createMessage(
    channelId: string,
    payload: CreateMessagePayload,
  ): Promise<APIMessage>;
  getMessage(channelId: string, messageId: string): Promise<APIMessage>;
  listMessages(
    channelId: string,
    query: ListMessagesQuery,
  ): Promise<APIMessage[]>;
  editMessage(
    channelId: string,
    messageId: string,
    payload: EditMessagePayload,
  ): Promise<APIMessage>;
  deleteMessage(
    channelId: string,
    messageId: string,
    reason: string,
  ): Promise<void>;
  pinMessage(channelId: string, messageId: string, reason: string): Promise<void>;
  unpinMessage(
    channelId: string,
    messageId: string,
    reason: string,
  ): Promise<void>;
  /** GET /guilds/{id}/webhooks -- every webhook in the guild. */
  listGuildWebhooks(guildId: string): Promise<APIWebhook[]>;
  /** GET /webhooks/{id} -- fetch one webhook by id, for identity checks. */
  getWebhook(webhookId: string): Promise<APIWebhook>;
  createWebhook(
    channelId: string,
    payload: CreateWebhookPayload,
    reason: string,
  ): Promise<APIWebhook>;
  deleteWebhook(webhookId: string, reason: string): Promise<void>;
}

export class DiscordEndpoints implements DiscordApi {
  constructor(private readonly client: DiscordClient) {}

  getCurrentUser(): Promise<APIUser> {
    return this.client.request<APIUser>("GET", "/users/@me");
  }

  /** Paginates through the bot's guilds (200 per page). */
  async listCurrentUserGuilds(): Promise<APIPartialGuild[]> {
    const all: APIPartialGuild[] = [];
    let after: string | undefined;
    for (let page = 0; page < 25; page++) {
      const query: Record<string, string> = { limit: "200" };
      if (after) query["after"] = after;
      const batch = await this.client.request<APIPartialGuild[]>(
        "GET",
        "/users/@me/guilds",
        { query },
      );
      all.push(...batch);
      if (batch.length < 200) break;
      const last = batch[batch.length - 1];
      if (!last) break;
      after = last.id;
    }
    return all;
  }

  getGuild(guildId: string): Promise<APIGuild> {
    return this.client.request<APIGuild>("GET", `/guilds/${guildId}`, {
      query: { with_counts: "true" },
    });
  }

  listGuildChannels(guildId: string): Promise<APIChannel[]> {
    return this.client.request<APIChannel[]>(
      "GET",
      `/guilds/${guildId}/channels`,
    );
  }

  listGuildRoles(guildId: string): Promise<APIRole[]> {
    return this.client.request<APIRole[]>("GET", `/guilds/${guildId}/roles`);
  }

  createGuild(payload: CreateGuildPayload): Promise<APIGuild> {
    return this.client.request<APIGuild>("POST", "/guilds", { body: payload });
  }

  createRole(
    guildId: string,
    payload: CreateRolePayload,
    reason: string,
  ): Promise<APIRole> {
    return this.client.request<APIRole>("POST", `/guilds/${guildId}/roles`, {
      body: payload,
      reason,
    });
  }

  modifyRole(
    guildId: string,
    roleId: string,
    payload: ModifyRolePayload,
    reason: string,
  ): Promise<APIRole> {
    return this.client.request<APIRole>(
      "PATCH",
      `/guilds/${guildId}/roles/${roleId}`,
      { body: payload, reason },
    );
  }

  modifyRolePositions(
    guildId: string,
    positions: RolePosition[],
    reason: string,
  ): Promise<APIRole[]> {
    return this.client.request<APIRole[]>(
      "PATCH",
      `/guilds/${guildId}/roles`,
      { body: positions, reason },
    );
  }

  createChannel(
    guildId: string,
    payload: CreateChannelPayload,
    reason: string,
  ): Promise<APIChannel> {
    return this.client.request<APIChannel>(
      "POST",
      `/guilds/${guildId}/channels`,
      { body: payload, reason },
    );
  }

  modifyChannel(
    channelId: string,
    payload: ModifyChannelPayload,
    reason: string,
  ): Promise<APIChannel> {
    return this.client.request<APIChannel>("PATCH", `/channels/${channelId}`, {
      body: payload,
      reason,
    });
  }

  modifyChannelPositions(
    guildId: string,
    positions: ChannelPosition[],
    reason: string,
  ): Promise<void> {
    return this.client.request<void>("PATCH", `/guilds/${guildId}/channels`, {
      body: positions,
      reason,
    });
  }

  setChannelPermission(
    channelId: string,
    overwriteId: string,
    payload: { type: OverwriteType; allow: string; deny: string },
    reason: string,
  ): Promise<void> {
    return this.client.request<void>(
      "PUT",
      `/channels/${channelId}/permissions/${overwriteId}`,
      { body: payload, reason },
    );
  }

  deleteChannelPermission(
    channelId: string,
    overwriteId: string,
    reason: string,
  ): Promise<void> {
    return this.client.request<void>(
      "DELETE",
      `/channels/${channelId}/permissions/${overwriteId}`,
      { reason },
    );
  }

  deleteChannel(channelId: string, reason: string): Promise<APIChannel> {
    return this.client.request<APIChannel>(
      "DELETE",
      `/channels/${channelId}`,
      { reason },
    );
  }

  deleteRole(guildId: string, roleId: string, reason: string): Promise<void> {
    return this.client.request<void>(
      "DELETE",
      `/guilds/${guildId}/roles/${roleId}`,
      { reason },
    );
  }

  createMessage(
    channelId: string,
    payload: CreateMessagePayload,
  ): Promise<APIMessage> {
    return this.client.request<APIMessage>(
      "POST",
      `/channels/${channelId}/messages`,
      { body: payload },
    );
  }

  getMessage(channelId: string, messageId: string): Promise<APIMessage> {
    return this.client.request<APIMessage>(
      "GET",
      `/channels/${channelId}/messages/${messageId}`,
    );
  }

  listMessages(
    channelId: string,
    query: ListMessagesQuery,
  ): Promise<APIMessage[]> {
    const q: Record<string, string> = { limit: String(query.limit) };
    if (query.before) q["before"] = query.before;
    if (query.after) q["after"] = query.after;
    return this.client.request<APIMessage[]>(
      "GET",
      `/channels/${channelId}/messages`,
      { query: q },
    );
  }

  editMessage(
    channelId: string,
    messageId: string,
    payload: EditMessagePayload,
  ): Promise<APIMessage> {
    return this.client.request<APIMessage>(
      "PATCH",
      `/channels/${channelId}/messages/${messageId}`,
      { body: payload },
    );
  }

  deleteMessage(
    channelId: string,
    messageId: string,
    reason: string,
  ): Promise<void> {
    return this.client.request<void>(
      "DELETE",
      `/channels/${channelId}/messages/${messageId}`,
      { reason },
    );
  }

  pinMessage(channelId: string, messageId: string, reason: string): Promise<void> {
    return this.client.request<void>(
      "PUT",
      `/channels/${channelId}/pins/${messageId}`,
      { reason },
    );
  }

  unpinMessage(
    channelId: string,
    messageId: string,
    reason: string,
  ): Promise<void> {
    return this.client.request<void>(
      "DELETE",
      `/channels/${channelId}/pins/${messageId}`,
      { reason },
    );
  }

  listGuildWebhooks(guildId: string): Promise<APIWebhook[]> {
    return this.client.request<APIWebhook[]>(
      "GET",
      `/guilds/${guildId}/webhooks`,
    );
  }

  getWebhook(webhookId: string): Promise<APIWebhook> {
    return this.client.request<APIWebhook>("GET", `/webhooks/${webhookId}`);
  }

  createWebhook(
    channelId: string,
    payload: CreateWebhookPayload,
    reason: string,
  ): Promise<APIWebhook> {
    return this.client.request<APIWebhook>(
      "POST",
      `/channels/${channelId}/webhooks`,
      { body: payload, reason },
    );
  }

  deleteWebhook(webhookId: string, reason: string): Promise<void> {
    return this.client.request<void>("DELETE", `/webhooks/${webhookId}`, {
      reason,
    });
  }
}
