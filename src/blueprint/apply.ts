/**
 * Executes a Plan against a live guild, and builds the single-request
 * POST /guilds payload for create_guild.
 *
 * Apply runs strictly serially (the client additionally spaces writes with
 * WRITE_DELAY_MS). On the first failure it stops and reports what was done
 * and what was not, so a partial apply is always visible to the caller.
 */

import { namesToBitfield, namesToBits } from "../discord/permissions.js";
import type {
  CreateChannelPayload,
  CreateGuildPayload,
  DiscordApi,
  GuildCreateChannel,
  GuildCreateRole,
  ModifyChannelPayload,
  ModifyRolePayload,
  OverwritePayload,
} from "../discord/endpoints.js";
import { CHANNEL_TYPE, CHANNEL_TYPE_BY_NAME } from "../discord/types.js";
import { log } from "../logging.js";
import type { LiveState, Plan, PlanOperation, ReadableOverwrite } from "./plan.js";
import { EVERYONE, type NormalizedBlueprint } from "./schema.js";

const AUDIT_PREFIX = "discord-provisioner-mcp";

export interface AppliedOperation {
  op: PlanOperation;
  status: "applied" | "failed" | "skipped";
  created_id?: string;
  detail?: string;
}

export interface ApplyResult {
  completed: boolean;
  results: AppliedOperation[];
  error?: string;
}

export async function applyPlan(
  api: DiscordApi,
  guildId: string,
  plan: Plan,
  live: LiveState,
): Promise<ApplyResult> {
  // Resolution maps: names -> snowflakes, extended as entities are created.
  const roleIdByName = new Map<string, string>();
  roleIdByName.set(EVERYONE, guildId);
  for (const r of live.roles) {
    if (r.id === guildId || r.managed) continue;
    if (!roleIdByName.has(r.name)) roleIdByName.set(r.name, r.id);
  }
  const categoryIdByName = new Map<string, string>();
  for (const c of live.channels) {
    if (c.type !== CHANNEL_TYPE.GUILD_CATEGORY) continue;
    const name = (c.name ?? "").trim();
    if (!categoryIdByName.has(name)) categoryIdByName.set(name, c.id);
  }

  const resolveRoleId = (roleName: string): string => {
    const id = roleIdByName.get(roleName);
    if (!id) {
      throw new Error(
        `Cannot resolve role "${roleName}" to an id; was its creation skipped or failed?`,
      );
    }
    return id;
  };

  const resolveOverwrites = (
    list: ReadableOverwrite[],
  ): OverwritePayload[] =>
    list.map((ow) => ({
      id: resolveRoleId(ow.role),
      type: 0 as const,
      allow: namesToBitfield(ow.allow),
      deny: namesToBitfield(ow.deny),
    }));

  const results: AppliedOperation[] = [];

  for (const op of plan.operations) {
    if (op.kind === "conflict") {
      results.push({ op, status: "skipped", detail: op.message });
      continue;
    }
    try {
      const applied = await applyOne(op);
      results.push(applied);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("apply operation failed", { kind: op.kind, error: message });
      results.push({ op, status: "failed", detail: message });
      return {
        completed: false,
        results,
        error:
          `Apply stopped at operation ${results.length}/${plan.operations.length} ` +
          `(${op.kind}): ${message}. Everything before it was applied; ` +
          `re-running apply_blueprint is safe and will resume from the diff.`,
      };
    }
  }

  return { completed: true, results };

  async function applyOne(op: PlanOperation): Promise<AppliedOperation> {
    switch (op.kind) {
      case "update_everyone_permissions": {
        await api.modifyRole(
          guildId,
          guildId,
          { permissions: namesToBitfield(op.changes.permissions.to) },
          `${AUDIT_PREFIX}: update @everyone permissions`,
        );
        return { op, status: "applied" };
      }
      case "create_role": {
        const payload: {
          name: string;
          color?: number;
          hoist?: boolean;
          mentionable?: boolean;
          permissions?: string;
        } = { name: op.role };
        if (op.payload.color !== null) {
          payload.color = parseInt(op.payload.color.replace(/^#/, ""), 16);
        }
        if (op.payload.hoist !== null) payload.hoist = op.payload.hoist;
        if (op.payload.mentionable !== null) {
          payload.mentionable = op.payload.mentionable;
        }
        if (op.payload.permissions !== null) {
          payload.permissions = namesToBitfield(op.payload.permissions);
        }
        const role = await api.createRole(
          guildId,
          payload,
          `${AUDIT_PREFIX}: create role "${op.role}"`,
        );
        roleIdByName.set(op.role, role.id);
        return { op, status: "applied", created_id: role.id };
      }
      case "update_role": {
        const payload: ModifyRolePayload = {};
        const c = op.changes;
        if (c["color"]) {
          payload.color = parseInt(String(c["color"].to).replace(/^#/, ""), 16);
        }
        if (c["hoist"]) payload.hoist = Boolean(c["hoist"].to);
        if (c["mentionable"]) payload.mentionable = Boolean(c["mentionable"].to);
        if (c["permissions"]) {
          payload.permissions = namesToBitfield(
            c["permissions"].to as string[],
          );
        }
        await api.modifyRole(
          guildId,
          op.role_id,
          payload,
          `${AUDIT_PREFIX}: update role "${op.role}"`,
        );
        return { op, status: "applied" };
      }
      case "set_role_positions": {
        const count = op.order.length;
        const positions = op.order
          .map((name, index) => {
            const id = roleIdByName.get(name);
            return id ? { id, position: count - index } : undefined;
          })
          .filter((p): p is { id: string; position: number } => p !== undefined);
        if (positions.length > 0) {
          await api.modifyRolePositions(
            guildId,
            positions,
            `${AUDIT_PREFIX}: order roles per blueprint`,
          );
        }
        return { op, status: "applied" };
      }
      case "create_category": {
        const channel = await api.createChannel(
          guildId,
          {
            name: op.category,
            type: CHANNEL_TYPE.GUILD_CATEGORY,
            position: op.position,
            permission_overwrites: resolveOverwrites(op.overwrites),
          },
          `${AUDIT_PREFIX}: create category "${op.category}"`,
        );
        categoryIdByName.set(op.category, channel.id);
        return { op, status: "applied", created_id: channel.id };
      }
      case "create_channel": {
        const payload: CreateChannelPayload = {
          name: op.channel,
          type: CHANNEL_TYPE_BY_NAME[
            op.type as keyof typeof CHANNEL_TYPE_BY_NAME
          ],
          position: op.position,
          permission_overwrites: resolveOverwrites(op.overwrites),
        };
        if (op.parent !== null) {
          const parentId = categoryIdByName.get(op.parent);
          if (!parentId) {
            throw new Error(
              `Cannot resolve category "${op.parent}" for channel "${op.channel}"`,
            );
          }
          payload.parent_id = parentId;
        }
        if (op.payload.topic !== null) payload.topic = op.payload.topic;
        if (op.payload.nsfw !== null) payload.nsfw = op.payload.nsfw;
        if (op.payload.rate_limit_per_user !== null) {
          payload.rate_limit_per_user = op.payload.rate_limit_per_user;
        }
        const channel = await api.createChannel(
          guildId,
          payload,
          `${AUDIT_PREFIX}: create channel "${op.channel}"`,
        );
        return { op, status: "applied", created_id: channel.id };
      }
      case "update_channel": {
        const payload: ModifyChannelPayload = {};
        const c = op.changes;
        if (c["topic"]) payload.topic = String(c["topic"].to);
        if (c["nsfw"]) payload.nsfw = Boolean(c["nsfw"].to);
        if (c["rate_limit_per_user"]) {
          payload.rate_limit_per_user = Number(c["rate_limit_per_user"].to);
        }
        await api.modifyChannel(
          op.channel_id,
          payload,
          `${AUDIT_PREFIX}: update channel "${op.channel}"`,
        );
        return { op, status: "applied" };
      }
      case "set_channel_overwrites": {
        for (const ow of op.overwrites) {
          await api.setChannelPermission(
            op.channel_id,
            resolveRoleId(ow.role),
            {
              type: 0,
              allow: namesToBitfield(ow.allow),
              deny: namesToBitfield(ow.deny),
            },
            `${AUDIT_PREFIX}: set overwrite for "${ow.role}" on "${op.channel}"`,
          );
        }
        for (const roleName of op.removes) {
          await api.deleteChannelPermission(
            op.channel_id,
            resolveRoleId(roleName),
            `${AUDIT_PREFIX}: remove overwrite for "${roleName}" on "${op.channel}"`,
          );
        }
        return { op, status: "applied" };
      }
      case "conflict":
        return { op, status: "skipped", detail: op.message };
      default: {
        const never: never = op;
        throw new Error(`Unknown operation kind: ${JSON.stringify(never)}`);
      }
    }
  }
}

/**
 * Build the POST /guilds payload for create_guild. Role and channel ids are
 * integer placeholders per the Discord docs: roles[0] is @everyone, channels
 * reference their category via a placeholder parent_id, and overwrites
 * reference placeholder role ids. Categories are listed before children.
 */
export function buildGuildCreatePayload(
  bp: NormalizedBlueprint,
): CreateGuildPayload {
  const rolePlaceholders = new Map<string, number>();
  rolePlaceholders.set(EVERYONE, 0);

  const roles: GuildCreateRole[] = [
    {
      id: 0,
      name: EVERYONE,
      ...(bp.everyonePermissions !== null
        ? { permissions: bp.everyonePermissions.toString() }
        : {}),
    },
  ];
  bp.roles.forEach((role, index) => {
    const id = index + 1;
    rolePlaceholders.set(role.name, id);
    const entry: GuildCreateRole = { id, name: role.name };
    if (role.color !== null) entry.color = role.color;
    if (role.hoist !== null) entry.hoist = role.hoist;
    if (role.mentionable !== null) entry.mentionable = role.mentionable;
    if (role.permissions !== null) {
      entry.permissions = role.permissions.toString();
    }
    roles.push(entry);
  });

  const channels: GuildCreateChannel[] = [];
  let nextChannelId = 100;
  const channelPlaceholderByApiName = new Map<string, number>();

  const overwritesFor = (
    list: NormalizedBlueprint["categories"][number]["overwrites"],
  ): GuildCreateChannel["permission_overwrites"] =>
    list.map((ow) => {
      const id = rolePlaceholders.get(ow.role);
      if (id === undefined) {
        throw new Error(`Unresolved role "${ow.role}" in guild create payload`);
      }
      return {
        id,
        type: 0 as const,
        allow: ow.allow.toString(),
        deny: ow.deny.toString(),
      };
    });

  const categoryPlaceholders = new Map<string, number>();
  for (const cat of bp.categories) {
    const id = nextChannelId++;
    categoryPlaceholders.set(cat.name, id);
    channels.push({
      id,
      name: cat.name,
      type: CHANNEL_TYPE.GUILD_CATEGORY,
      permission_overwrites: overwritesFor(cat.overwrites),
    });
  }

  const pushChannel = (
    ch: NormalizedBlueprint["topLevelChannels"][number],
  ): void => {
    const id = nextChannelId++;
    if (!channelPlaceholderByApiName.has(ch.apiName)) {
      channelPlaceholderByApiName.set(ch.apiName, id);
    }
    const entry: GuildCreateChannel = {
      id,
      name: ch.apiName,
      type: ch.type,
      permission_overwrites: overwritesFor(ch.overwrites),
    };
    if (ch.parent !== null) {
      const parentId = categoryPlaceholders.get(ch.parent);
      if (parentId === undefined) {
        throw new Error(`Unresolved category "${ch.parent}"`);
      }
      entry.parent_id = parentId;
    }
    if (ch.topic !== null) entry.topic = ch.topic;
    if (ch.nsfw !== null) entry.nsfw = ch.nsfw;
    if (ch.rateLimitPerUser !== null) {
      entry.rate_limit_per_user = ch.rateLimitPerUser;
    }
    channels.push(entry);
  };

  for (const cat of bp.categories) {
    for (const ch of cat.channels) pushChannel(ch);
  }
  for (const ch of bp.topLevelChannels) pushChannel(ch);

  const payload: CreateGuildPayload = { name: bp.name };
  if (bp.icon !== null) payload.icon = bp.icon;
  if (bp.verificationLevel !== null) {
    payload.verification_level = bp.verificationLevel;
  }
  if (bp.defaultMessageNotifications !== null) {
    payload.default_message_notifications = bp.defaultMessageNotifications;
  }
  if (bp.explicitContentFilter !== null) {
    payload.explicit_content_filter = bp.explicitContentFilter;
  }
  if (bp.afkTimeout !== null) payload.afk_timeout = bp.afkTimeout;
  if (roles.length > 1 || bp.everyonePermissions !== null) {
    payload.roles = roles;
  }
  if (channels.length > 0) payload.channels = channels;
  if (bp.systemChannelName !== null) {
    const id = channelPlaceholderByApiName.get(bp.systemChannelName);
    if (id !== undefined) payload.system_channel_id = id;
  }
  if (bp.afkChannelName !== null) {
    const id = channelPlaceholderByApiName.get(bp.afkChannelName);
    if (id !== undefined) payload.afk_channel_id = id;
  }
  return payload;
}
