/** Test doubles: an in-memory Discord (FakeApi) and a fetch stub. No test touches the network. */

import type {
  ChannelPosition,
  CreateChannelPayload,
  CreateGuildPayload,
  CreateMessagePayload,
  CreateRolePayload,
  CreateWebhookPayload,
  DiscordApi,
  EditMessagePayload,
  ListMessagesQuery,
  ModifyChannelPayload,
  ModifyRolePayload,
  RolePosition,
} from "../src/discord/endpoints.js";
import type {
  APIChannel,
  APIGuild,
  APIMessage,
  APIPartialGuild,
  APIRole,
  APIUser,
  APIWebhook,
  OverwriteType,
} from "../src/discord/types.js";

export class FakeApi implements DiscordApi {
  readonly guildId = "100000000000000001";
  readonly botUserId = "300000000000000001";
  roles: APIRole[];
  channels: APIChannel[] = [];
  messages: APIMessage[] = [];
  webhooks: APIWebhook[] = [];
  guildList: APIPartialGuild[] = [
    { id: "100000000000000001", name: "Fake Guild", owner: true },
  ];
  /** Count of mutating calls; used to assert a second apply is a no-op. */
  writes = 0;
  createdGuildPayloads: CreateGuildPayload[] = [];

  private nextId = 0n;

  constructor() {
    this.roles = [
      {
        id: this.guildId,
        name: "@everyone",
        color: 0,
        hoist: false,
        position: 0,
        permissions: "0",
        managed: false,
        mentionable: false,
      },
    ];
  }

  newId(): string {
    this.nextId += 1n;
    return (200000000000000000n + this.nextId).toString();
  }

  snapshot(): { guildId: string; roles: APIRole[]; channels: APIChannel[] } {
    return {
      guildId: this.guildId,
      roles: JSON.parse(JSON.stringify(this.roles)) as APIRole[],
      channels: JSON.parse(JSON.stringify(this.channels)) as APIChannel[],
    };
  }

  async getCurrentUser(): Promise<APIUser> {
    return {
      id: this.botUserId,
      username: "fake-bot",
      discriminator: "0",
      bot: true,
    };
  }

  async listCurrentUserGuilds(): Promise<APIPartialGuild[]> {
    return this.guildList;
  }

  async getGuild(guildId: string): Promise<APIGuild> {
    return {
      id: guildId,
      name: "Fake Guild",
      owner_id: "300000000000000001",
      roles: this.roles,
    };
  }

  async listGuildChannels(): Promise<APIChannel[]> {
    return this.channels;
  }

  async listGuildRoles(): Promise<APIRole[]> {
    return this.roles;
  }

  async createGuild(payload: CreateGuildPayload): Promise<APIGuild> {
    this.writes++;
    this.createdGuildPayloads.push(payload);
    return { id: this.newId(), name: payload.name, owner_id: "300000000000000001" };
  }

  async createRole(
    _guildId: string,
    payload: CreateRolePayload,
    _reason: string,
  ): Promise<APIRole> {
    this.writes++;
    const role: APIRole = {
      id: this.newId(),
      name: payload.name,
      color: payload.color ?? 0,
      hoist: payload.hoist ?? false,
      position: 1,
      permissions: payload.permissions ?? "0",
      managed: false,
      mentionable: payload.mentionable ?? false,
    };
    this.roles.push(role);
    return role;
  }

  async modifyRole(
    _guildId: string,
    roleId: string,
    payload: ModifyRolePayload,
    _reason: string,
  ): Promise<APIRole> {
    this.writes++;
    const role = this.roles.find((r) => r.id === roleId);
    if (!role) throw new Error(`FakeApi: no role ${roleId}`);
    if (payload.name !== undefined) role.name = payload.name;
    if (payload.color !== undefined) role.color = payload.color;
    if (payload.hoist !== undefined) role.hoist = payload.hoist;
    if (payload.mentionable !== undefined) role.mentionable = payload.mentionable;
    if (payload.permissions !== undefined) role.permissions = payload.permissions;
    return role;
  }

  async modifyRolePositions(
    _guildId: string,
    positions: RolePosition[],
    _reason: string,
  ): Promise<APIRole[]> {
    this.writes++;
    for (const p of positions) {
      const role = this.roles.find((r) => r.id === p.id);
      if (role) role.position = p.position;
    }
    return this.roles;
  }

  async createChannel(
    guildId: string,
    payload: CreateChannelPayload,
    _reason: string,
  ): Promise<APIChannel> {
    this.writes++;
    const channel: APIChannel = {
      id: this.newId(),
      type: payload.type,
      guild_id: guildId,
      name: payload.name,
      position: payload.position ?? 0,
      parent_id: payload.parent_id ?? null,
      topic: payload.topic ?? null,
      nsfw: payload.nsfw ?? false,
      rate_limit_per_user: payload.rate_limit_per_user ?? 0,
      permission_overwrites: (payload.permission_overwrites ?? []).map((ow) => ({
        id: ow.id,
        type: ow.type,
        allow: ow.allow,
        deny: ow.deny,
      })),
    };
    this.channels.push(channel);
    return channel;
  }

  async modifyChannel(
    channelId: string,
    payload: ModifyChannelPayload,
    _reason: string,
  ): Promise<APIChannel> {
    this.writes++;
    const channel = this.channels.find((c) => c.id === channelId);
    if (!channel) throw new Error(`FakeApi: no channel ${channelId}`);
    if (payload.name !== undefined) channel.name = payload.name;
    if (payload.topic !== undefined) channel.topic = payload.topic;
    if (payload.nsfw !== undefined) channel.nsfw = payload.nsfw;
    if (payload.rate_limit_per_user !== undefined) {
      channel.rate_limit_per_user = payload.rate_limit_per_user;
    }
    if (payload.parent_id !== undefined) channel.parent_id = payload.parent_id;
    return channel;
  }

  async modifyChannelPositions(
    _guildId: string,
    positions: ChannelPosition[],
    _reason: string,
  ): Promise<void> {
    this.writes++;
    for (const p of positions) {
      const channel = this.channels.find((c) => c.id === p.id);
      if (channel) {
        channel.position = p.position;
        if (p.parent_id !== undefined) channel.parent_id = p.parent_id;
      }
    }
  }

  async setChannelPermission(
    channelId: string,
    overwriteId: string,
    payload: { type: OverwriteType; allow: string; deny: string },
    _reason: string,
  ): Promise<void> {
    this.writes++;
    const channel = this.channels.find((c) => c.id === channelId);
    if (!channel) throw new Error(`FakeApi: no channel ${channelId}`);
    channel.permission_overwrites = channel.permission_overwrites ?? [];
    const existing = channel.permission_overwrites.find(
      (ow) => ow.id === overwriteId,
    );
    if (existing) {
      existing.type = payload.type;
      existing.allow = payload.allow;
      existing.deny = payload.deny;
    } else {
      channel.permission_overwrites.push({
        id: overwriteId,
        type: payload.type,
        allow: payload.allow,
        deny: payload.deny,
      });
    }
  }

  async deleteChannelPermission(
    channelId: string,
    overwriteId: string,
    _reason: string,
  ): Promise<void> {
    this.writes++;
    const channel = this.channels.find((c) => c.id === channelId);
    if (!channel) throw new Error(`FakeApi: no channel ${channelId}`);
    channel.permission_overwrites = (channel.permission_overwrites ?? []).filter(
      (ow) => ow.id !== overwriteId,
    );
  }

  async deleteChannel(channelId: string, _reason: string): Promise<APIChannel> {
    this.writes++;
    const channel = this.channels.find((c) => c.id === channelId);
    if (!channel) throw new Error(`FakeApi: no channel ${channelId}`);
    this.channels = this.channels.filter((c) => c.id !== channelId);
    return channel;
  }

  async deleteRole(
    _guildId: string,
    roleId: string,
    _reason: string,
  ): Promise<void> {
    this.writes++;
    this.roles = this.roles.filter((r) => r.id !== roleId);
  }

  async createMessage(
    channelId: string,
    payload: CreateMessagePayload,
  ): Promise<APIMessage> {
    this.writes++;
    const message: APIMessage = {
      id: this.newId(),
      channel_id: channelId,
      author: {
        id: this.botUserId,
        username: "fake-bot",
        discriminator: "0",
        bot: true,
      },
      content: payload.content,
      timestamp: new Date(0).toISOString(),
      pinned: false,
      type: 0,
      ...(payload.flags !== undefined ? { flags: payload.flags } : {}),
    };
    this.messages.push(message);
    return message;
  }

  async getMessage(channelId: string, messageId: string): Promise<APIMessage> {
    const message = this.messages.find(
      (m) => m.id === messageId && m.channel_id === channelId,
    );
    if (!message) {
      throw new Error(`FakeApi: no message ${messageId} in channel ${channelId}`);
    }
    return message;
  }

  async listMessages(
    channelId: string,
    query: ListMessagesQuery,
  ): Promise<APIMessage[]> {
    let messages = this.messages.filter((m) => m.channel_id === channelId);
    if (query.before !== undefined) {
      messages = messages.filter((m) => m.id < (query.before as string));
    }
    if (query.after !== undefined) {
      messages = messages.filter((m) => m.id > (query.after as string));
    }
    return [...messages].reverse().slice(0, query.limit);
  }

  async editMessage(
    channelId: string,
    messageId: string,
    payload: EditMessagePayload,
  ): Promise<APIMessage> {
    this.writes++;
    const message = await this.getMessage(channelId, messageId);
    message.content = payload.content;
    message.edited_timestamp = new Date(1).toISOString();
    return message;
  }

  async deleteMessage(
    channelId: string,
    messageId: string,
    _reason: string,
  ): Promise<void> {
    this.writes++;
    await this.getMessage(channelId, messageId);
    this.messages = this.messages.filter((m) => m.id !== messageId);
  }

  async pinMessage(
    channelId: string,
    messageId: string,
    _reason: string,
  ): Promise<void> {
    this.writes++;
    const message = await this.getMessage(channelId, messageId);
    message.pinned = true;
  }

  async unpinMessage(
    channelId: string,
    messageId: string,
    _reason: string,
  ): Promise<void> {
    this.writes++;
    const message = await this.getMessage(channelId, messageId);
    message.pinned = false;
  }

  async listGuildWebhooks(guildId: string): Promise<APIWebhook[]> {
    return this.webhooks.filter((w) => w.guild_id === guildId);
  }

  async getWebhook(webhookId: string): Promise<APIWebhook> {
    const webhook = this.webhooks.find((w) => w.id === webhookId);
    if (!webhook) throw new Error(`FakeApi: no webhook ${webhookId}`);
    return webhook;
  }

  /**
   * Mirrors real Discord: a webhook's guild is implied by its channel, not a
   * separate parameter. Looks up the channel's own guild_id, falling back to
   * this fake's default guild when the channel wasn't tracked via
   * createChannel.
   */
  async createWebhook(
    channelId: string,
    payload: CreateWebhookPayload,
    _reason: string,
  ): Promise<APIWebhook> {
    this.writes++;
    const channel = this.channels.find((c) => c.id === channelId);
    const webhook: APIWebhook = {
      id: this.newId(),
      type: 1,
      guild_id: channel?.guild_id ?? this.guildId,
      channel_id: channelId,
      name: payload.name,
      application_id: null,
      user: {
        id: this.botUserId,
        username: "fake-bot",
        discriminator: "0",
        bot: true,
      },
      // Present on real incoming webhooks; FakeApi includes them so tests
      // can assert these NEVER reach tool output.
      token: "FAKE_WEBHOOK_TOKEN_MUST_NOT_LEAK",
      url: "https://discord.com/api/webhooks/fake/FAKE_WEBHOOK_TOKEN_MUST_NOT_LEAK",
    };
    this.webhooks.push(webhook);
    return webhook;
  }

  async deleteWebhook(webhookId: string, _reason: string): Promise<void> {
    this.writes++;
    const before = this.webhooks.length;
    this.webhooks = this.webhooks.filter((w) => w.id !== webhookId);
    if (this.webhooks.length === before) {
      throw new Error(`FakeApi: no webhook ${webhookId}`);
    }
  }
}

// ---------------------------------------------------------------------------
// fetch stub for DiscordClient tests
// ---------------------------------------------------------------------------

export interface RecordedCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface StubResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export function makeResponse(spec: StubResponse): Response {
  const status = spec.status ?? 200;
  return new Response(
    status === 204 ? null : JSON.stringify(spec.body ?? {}),
    { status, headers: spec.headers ?? {} },
  );
}

/**
 * Fetch stub. The handler receives the recorded call and the 1-based call
 * index and returns a StubResponse (or a promise of one).
 */
export function fetchStub(
  handler: (
    call: RecordedCall,
    index: number,
  ) => StubResponse | Promise<StubResponse>,
): { fn: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fn = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const call: RecordedCall = {
      method: init?.method ?? "GET",
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body:
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const spec = await handler(call, calls.length);
    return makeResponse(spec);
  }) as typeof fetch;
  return { fn, calls };
}

/** Sleep/clock recorder: sleeps resolve instantly, the clock stays frozen. */
export function fakeTime(): {
  sleeps: number[];
  sleep: (ms: number) => Promise<void>;
  now: () => number;
} {
  const sleeps: number[] = [];
  return {
    sleeps,
    sleep: async (ms: number): Promise<void> => {
      sleeps.push(ms);
    },
    now: () => 0,
  };
}

/** The worked example blueprint from the README, as a plain object. */
export const EXAMPLE_BLUEPRINT = {
  name: "Example Server",
  everyone_permissions: ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"],
  roles: [
    {
      name: "Admin",
      color: "#e74c3c",
      hoist: true,
      permissions: ["ADMINISTRATOR"],
    },
    {
      name: "Member",
      permissions: [
        "VIEW_CHANNEL",
        "SEND_MESSAGES",
        "READ_MESSAGE_HISTORY",
        "ADD_REACTIONS",
      ],
    },
  ],
  categories: [
    {
      name: "INFORMATION",
      private_to: [],
      channels: [
        { name: "announcements", type: "announcement", locked: true },
        { name: "rules", type: "text", locked: true },
      ],
    },
    {
      name: "STAFF",
      private_to: ["Admin"],
      channels: [{ name: "staff-chat", type: "text" }],
    },
  ],
} as const;
