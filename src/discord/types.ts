/** Minimal typed shapes for the Discord REST resources this server touches. */

export interface APIUser {
  id: string;
  username: string;
  discriminator: string;
  global_name?: string | null;
  bot?: boolean;
}

export interface APIRole {
  id: string;
  name: string;
  color: number;
  hoist: boolean;
  position: number;
  /** Permission bitfield serialised as a decimal string (exceeds 2^53). */
  permissions: string;
  managed: boolean;
  mentionable: boolean;
}

/** Permission overwrite target type: 0 = role, 1 = member. */
export type OverwriteType = 0 | 1;

export interface APIOverwrite {
  id: string;
  type: OverwriteType;
  allow: string;
  deny: string;
}

export interface APIChannel {
  id: string;
  type: number;
  guild_id?: string;
  name: string | null;
  position?: number;
  parent_id?: string | null;
  topic?: string | null;
  nsfw?: boolean;
  rate_limit_per_user?: number;
  permission_overwrites?: APIOverwrite[];
}

export interface APIGuild {
  id: string;
  name: string;
  owner_id: string;
  icon?: string | null;
  verification_level?: number;
  default_message_notifications?: number;
  explicit_content_filter?: number;
  system_channel_id?: string | null;
  afk_channel_id?: string | null;
  afk_timeout?: number;
  roles?: APIRole[];
  approximate_member_count?: number;
}

/** Shape returned by GET /users/@me/guilds. */
export interface APIPartialGuild {
  id: string;
  name: string;
  owner?: boolean;
  permissions?: string;
}

/** Channel types used by this server (subset of Discord's full list). */
export const CHANNEL_TYPE = {
  GUILD_TEXT: 0,
  GUILD_VOICE: 2,
  GUILD_CATEGORY: 4,
  GUILD_ANNOUNCEMENT: 5,
  GUILD_STAGE_VOICE: 13,
  GUILD_FORUM: 15,
  GUILD_MEDIA: 16,
} as const;

/** Minimal embed metadata surfaced by list_messages -- never the raw embed object. */
export interface APIEmbed {
  type?: string;
  title?: string | null;
  description?: string | null;
  url?: string | null;
  color?: number | null;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
}

export interface APIMessage {
  id: string;
  channel_id: string;
  author: APIUser;
  content: string;
  timestamp: string;
  edited_timestamp?: string | null;
  pinned: boolean;
  type: number;
  /** Present when the message was posted by a webhook rather than a real bot/user. */
  webhook_id?: string;
  embeds?: APIEmbed[];
  flags?: number;
}

/** Message flag bits this server sets. Full list: Discord docs "Message Object". */
export const MESSAGE_FLAGS = {
  SUPPRESS_EMBEDS: 1 << 2,
} as const;

/** Webhook type: 1 = Incoming, 2 = Channel Follower, 3 = Application-owned. */
export const WEBHOOK_TYPE = {
  INCOMING: 1,
  CHANNEL_FOLLOWER: 2,
  APPLICATION: 3,
} as const;

const WEBHOOK_TYPE_NAME_BY_NUM: ReadonlyMap<number, string> = new Map([
  [WEBHOOK_TYPE.INCOMING, "incoming"],
  [WEBHOOK_TYPE.CHANNEL_FOLLOWER, "channel_follower"],
  [WEBHOOK_TYPE.APPLICATION, "application"],
]);

export function webhookTypeName(type: number): string {
  return WEBHOOK_TYPE_NAME_BY_NUM.get(type) ?? `type_${type}`;
}

/**
 * Raw shape of a Discord webhook object. `token` and `url` are ONLY present
 * for Incoming webhooks the caller can manage -- they are bearer credentials
 * (anyone holding them can post as the webhook with no further auth) and
 * must never leave this file's boundary unsanitized. See publicWebhook in
 * tools/shared.ts, which is the only place a webhook should be turned into
 * tool output.
 */
export interface APIWebhook {
  id: string;
  type: number;
  guild_id?: string | null;
  channel_id: string;
  name: string | null;
  avatar?: string | null;
  application_id?: string | null;
  user?: APIUser;
  /** Incoming webhook bearer credential. NEVER expose this. */
  token?: string;
  /** Full execution URL, which embeds the token. NEVER expose this. */
  url?: string;
}

/** Blueprint-facing channel type names mapped to Discord numeric types. */
export const CHANNEL_TYPE_BY_NAME = {
  text: CHANNEL_TYPE.GUILD_TEXT,
  voice: CHANNEL_TYPE.GUILD_VOICE,
  category: CHANNEL_TYPE.GUILD_CATEGORY,
  announcement: CHANNEL_TYPE.GUILD_ANNOUNCEMENT,
  stage: CHANNEL_TYPE.GUILD_STAGE_VOICE,
  forum: CHANNEL_TYPE.GUILD_FORUM,
  media: CHANNEL_TYPE.GUILD_MEDIA,
} as const;

export type ChannelTypeName = keyof typeof CHANNEL_TYPE_BY_NAME;

const NAME_BY_CHANNEL_TYPE: ReadonlyMap<number, string> = new Map(
  Object.entries(CHANNEL_TYPE_BY_NAME).map(([name, num]) => [num, name]),
);

export function channelTypeName(type: number): string {
  return NAME_BY_CHANNEL_TYPE.get(type) ?? `type_${type}`;
}

/**
 * Discord lowercases and kebab-cases the names of text-like channels
 * server-side. Mirror that here so that planning matches what Discord will
 * actually store, which keeps a second apply of the same blueprint a no-op.
 */
export function normalizeChannelName(type: number, name: string): string {
  const textLike =
    type === CHANNEL_TYPE.GUILD_TEXT ||
    type === CHANNEL_TYPE.GUILD_ANNOUNCEMENT ||
    type === CHANNEL_TYPE.GUILD_FORUM ||
    type === CHANNEL_TYPE.GUILD_MEDIA;
  if (!textLike) return name.trim();
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/[^a-z0-9_-]/g, "");
}
