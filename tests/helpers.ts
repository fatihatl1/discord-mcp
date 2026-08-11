/** Test doubles: an in-memory Discord (FakeApi) and a fetch stub. No test touches the network. */

import type {
  ChannelPosition,
  CreateChannelPayload,
  CreateGuildPayload,
  CreateRolePayload,
  DiscordApi,
  ModifyChannelPayload,
  ModifyRolePayload,
  RolePosition,
} from "../src/discord/endpoints.js";
import type {
  APIChannel,
  APIGuild,
  APIPartialGuild,
  APIRole,
  APIUser,
  OverwriteType,
} from "../src/discord/types.js";

export class FakeApi implements DiscordApi {
  readonly guildId = "100000000000000001";
  roles: APIRole[];
  channels: APIChannel[] = [];
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
      id: "300000000000000001",
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
