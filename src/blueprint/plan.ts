/**
 * Blueprint -> ordered operation plan, diffed against live guild state.
 *
 * Rules:
 * - Entities match by name (roles case-sensitively; channels by their
 *   Discord-normalised name within their parent category).
 * - Nothing is ever deleted. Live entities absent from the blueprint are
 *   reported as orphans for the user to decide about.
 * - create_only mode only creates what is missing. reconcile mode also
 *   updates anything that differs.
 * - Role-type permission overwrites on blueprint-managed channels are fully
 *   managed (converged to the blueprint, including removals). Member-type
 *   overwrites are never touched.
 * - A blueprint that matches live state produces zero operations.
 */

import {
  bitfieldToNames,
  parseBitfield,
} from "../discord/permissions.js";
import type { APIChannel, APIOverwrite, APIRole } from "../discord/types.js";
import { CHANNEL_TYPE, channelTypeName } from "../discord/types.js";
import {
  EVERYONE,
  readableOverwrite,
  type NormalizedBlueprint,
  type NormalizedChannel,
  type NormalizedOverwrite,
} from "./schema.js";

export type PlanMode = "create_only" | "reconcile";

export interface ReadableOverwrite {
  role: string;
  allow: string[];
  deny: string[];
}

export interface FieldChange {
  from: unknown;
  to: unknown;
}

export type PlanOperation =
  | {
      kind: "update_everyone_permissions";
      changes: { permissions: { from: string[]; to: string[] } };
    }
  | {
      kind: "create_role";
      role: string;
      payload: {
        color: string | null;
        hoist: boolean | null;
        mentionable: boolean | null;
        permissions: string[] | null;
      };
    }
  | {
      kind: "update_role";
      role: string;
      role_id: string;
      changes: Record<string, FieldChange>;
    }
  | {
      kind: "set_role_positions";
      /** Blueprint roles, top of the list first. */
      order: string[];
    }
  | {
      kind: "create_category";
      category: string;
      position: number;
      overwrites: ReadableOverwrite[];
    }
  | {
      kind: "create_channel";
      channel: string;
      type: string;
      parent: string | null;
      position: number;
      payload: {
        topic: string | null;
        nsfw: boolean | null;
        rate_limit_per_user: number | null;
      };
      overwrites: ReadableOverwrite[];
    }
  | {
      kind: "update_channel";
      channel: string;
      parent: string | null;
      channel_id: string;
      changes: Record<string, FieldChange>;
    }
  | {
      kind: "set_channel_overwrites";
      channel: string;
      parent: string | null;
      channel_id: string;
      overwrites: ReadableOverwrite[];
      /** Role names whose live overwrites are removed (not in blueprint). */
      removes: string[];
    }
  | {
      kind: "conflict";
      channel: string;
      parent: string | null;
      message: string;
    };

export interface SkippedEntry {
  kind: string;
  name: string;
  reason: string;
}

export interface Plan {
  mode: PlanMode;
  operations: PlanOperation[];
  /** Existing entities the blueprint does not mention. NEVER deleted. */
  orphans: {
    roles: Array<{ id: string; name: string }>;
    channels: Array<{ id: string; name: string; type: string }>;
  };
  skipped: SkippedEntry[];
  warnings: string[];
  summary: {
    operations: number;
    creates: number;
    updates: number;
    conflicts: number;
    skipped: number;
  };
}

export interface LiveState {
  guildId: string;
  roles: APIRole[];
  channels: APIChannel[];
}

interface OverwriteDiff {
  equal: boolean;
  removes: string[];
}

export function buildPlan(
  bp: NormalizedBlueprint,
  live: LiveState,
  mode: PlanMode,
): Plan {
  const warnings: string[] = [];
  const skipped: SkippedEntry[] = [];
  const ops: PlanOperation[] = [];
  const conflictOps: PlanOperation[] = [];

  // ---- live role indexes ----
  const everyoneRole = live.roles.find((r) => r.id === live.guildId);
  const roleNameById = new Map<string, string>();
  for (const r of live.roles) roleNameById.set(r.id, r.name);
  if (everyoneRole) roleNameById.set(everyoneRole.id, EVERYONE);

  const liveRolesByName = new Map<string, APIRole>();
  for (const r of live.roles) {
    if (r.id === live.guildId) continue;
    if (r.managed) continue; // bot/integration roles are not manageable
    if (liveRolesByName.has(r.name)) {
      warnings.push(
        `Live guild has multiple roles named "${r.name}"; matching the first one (id ${liveRolesByName.get(r.name)?.id}).`,
      );
      continue;
    }
    liveRolesByName.set(r.name, r);
  }

  // ---- @everyone permissions ----
  if (bp.everyonePermissions !== null && everyoneRole) {
    const liveBits = parseBitfield(everyoneRole.permissions);
    if (liveBits !== bp.everyonePermissions) {
      const change = {
        permissions: {
          from: bitfieldToNames(everyoneRole.permissions),
          to: bitfieldToNames(bp.everyonePermissions.toString()),
        },
      };
      if (mode === "reconcile") {
        ops.push({ kind: "update_everyone_permissions", changes: change });
      } else {
        skipped.push({
          kind: "everyone_permissions",
          name: EVERYONE,
          reason: "differs from blueprint, but mode is create_only",
        });
      }
    }
  }

  // ---- roles ----
  const matchedRoleNames = new Set<string>();
  let createdRoles = 0;

  for (const role of bp.roles) {
    const liveRole = liveRolesByName.get(role.name);
    if (!liveRole) {
      createdRoles++;
      ops.push({
        kind: "create_role",
        role: role.name,
        payload: {
          color:
            role.color !== null
              ? `#${role.color.toString(16).padStart(6, "0")}`
              : null,
          hoist: role.hoist,
          mentionable: role.mentionable,
          permissions:
            role.permissions !== null
              ? bitfieldToNames(role.permissions.toString())
              : null,
        },
      });
      continue;
    }
    matchedRoleNames.add(role.name);

    const changes: Record<string, FieldChange> = {};
    if (role.color !== null && liveRole.color !== role.color) {
      changes["color"] = {
        from: `#${liveRole.color.toString(16).padStart(6, "0")}`,
        to: `#${role.color.toString(16).padStart(6, "0")}`,
      };
    }
    if (role.hoist !== null && liveRole.hoist !== role.hoist) {
      changes["hoist"] = { from: liveRole.hoist, to: role.hoist };
    }
    if (role.mentionable !== null && liveRole.mentionable !== role.mentionable) {
      changes["mentionable"] = {
        from: liveRole.mentionable,
        to: role.mentionable,
      };
    }
    if (
      role.permissions !== null &&
      parseBitfield(liveRole.permissions) !== role.permissions
    ) {
      changes["permissions"] = {
        from: bitfieldToNames(liveRole.permissions),
        to: bitfieldToNames(role.permissions.toString()),
      };
    }
    if (Object.keys(changes).length > 0) {
      if (mode === "reconcile") {
        ops.push({
          kind: "update_role",
          role: role.name,
          role_id: liveRole.id,
          changes,
        });
      } else {
        skipped.push({
          kind: "role",
          name: role.name,
          reason: `exists but differs (${Object.keys(changes).join(", ")}); mode is create_only`,
        });
      }
    }
  }

  // ---- role positions ----
  // Blueprint order is top-to-bottom. Only the relative order of blueprint
  // roles matters; other roles (including the bot's own) are left alone.
  if (bp.roles.length > 0) {
    let orderCorrect = createdRoles === 0;
    if (orderCorrect) {
      let prev = Number.POSITIVE_INFINITY;
      for (const role of bp.roles) {
        const liveRole = liveRolesByName.get(role.name);
        if (!liveRole) {
          orderCorrect = false;
          break;
        }
        if (liveRole.position >= prev) {
          orderCorrect = false;
          break;
        }
        prev = liveRole.position;
      }
    }
    if (!orderCorrect) {
      if (mode === "reconcile") {
        ops.push({
          kind: "set_role_positions",
          order: bp.roles.map((r) => r.name),
        });
      } else if (createdRoles === 0) {
        skipped.push({
          kind: "role_positions",
          name: "(all roles)",
          reason: "order differs from blueprint; mode is create_only",
        });
      }
      // create_only with new roles: they land wherever Discord puts them;
      // reconcile later if ordering matters.
    }
  }

  // ---- live channel indexes ----
  const liveCategories = live.channels.filter(
    (c) => c.type === CHANNEL_TYPE.GUILD_CATEGORY,
  );
  const liveCategoryById = new Map<string, APIChannel>();
  const liveCategoryByName = new Map<string, APIChannel>();
  for (const c of liveCategories) {
    liveCategoryById.set(c.id, c);
    const name = (c.name ?? "").trim();
    if (!liveCategoryByName.has(name)) liveCategoryByName.set(name, c);
  }

  const liveNonCategory = live.channels.filter(
    (c) => c.type !== CHANNEL_TYPE.GUILD_CATEGORY,
  );
  const channelKey = (name: string, parentName: string | null): string =>
    `${parentName ?? ""}|${name}`;
  const liveChannelByKey = new Map<string, APIChannel>();
  for (const c of liveNonCategory) {
    const parentName = c.parent_id
      ? ((liveCategoryById.get(c.parent_id)?.name ?? "").trim() || null)
      : null;
    const key = channelKey(c.name ?? "", parentName);
    if (!liveChannelByKey.has(key)) liveChannelByKey.set(key, c);
  }

  const matchedChannelIds = new Set<string>();
  const bpRoleNames = new Set(bp.roles.map((r) => r.name));

  const diffOverwrites = (
    desired: NormalizedOverwrite[],
    liveOverwrites: APIOverwrite[] | undefined,
  ): OverwriteDiff => {
    const liveByRole = new Map<string, { allow: bigint; deny: bigint }>();
    for (const ow of liveOverwrites ?? []) {
      if (ow.type === 1) {
        continue; // member overwrites are preserved, never managed
      }
      const roleName =
        ow.id === live.guildId ? EVERYONE : roleNameById.get(ow.id);
      if (roleName === undefined) continue; // overwrite for a deleted role
      liveByRole.set(roleName, {
        allow: parseBitfield(ow.allow),
        deny: parseBitfield(ow.deny),
      });
    }

    let equal = true;
    for (const d of desired) {
      const liveEntry = liveByRole.get(d.role);
      if (!liveEntry || liveEntry.allow !== d.allow || liveEntry.deny !== d.deny) {
        equal = false;
      }
      liveByRole.delete(d.role);
    }
    // Anything left is a live role overwrite the blueprint does not define.
    // Only overwrites for roles the blueprint knows about (or @everyone) are
    // removed; overwrites for unrelated live roles are left in place.
    const removes: string[] = [];
    for (const roleName of liveByRole.keys()) {
      if (roleName === EVERYONE || bpRoleNames.has(roleName)) {
        removes.push(roleName);
        equal = false;
      }
    }
    return { equal, removes };
  };

  const planExistingChannel = (
    ch: NormalizedChannel,
    liveCh: APIChannel,
  ): void => {
    matchedChannelIds.add(liveCh.id);

    if (liveCh.type !== ch.type) {
      conflictOps.push({
        kind: "conflict",
        channel: ch.apiName,
        parent: ch.parent,
        message:
          `Channel "${ch.apiName}" exists as type ${channelTypeName(liveCh.type)} ` +
          `but the blueprint wants ${ch.typeName}. Discord cannot convert between ` +
          `these types; rename one of them. No action taken.`,
      });
      return;
    }

    const changes: Record<string, FieldChange> = {};
    if (ch.topic !== null && (liveCh.topic ?? "") !== ch.topic) {
      changes["topic"] = { from: liveCh.topic ?? "", to: ch.topic };
    }
    if (ch.nsfw !== null && (liveCh.nsfw ?? false) !== ch.nsfw) {
      changes["nsfw"] = { from: liveCh.nsfw ?? false, to: ch.nsfw };
    }
    if (
      ch.rateLimitPerUser !== null &&
      (liveCh.rate_limit_per_user ?? 0) !== ch.rateLimitPerUser
    ) {
      changes["rate_limit_per_user"] = {
        from: liveCh.rate_limit_per_user ?? 0,
        to: ch.rateLimitPerUser,
      };
    }

    if (Object.keys(changes).length > 0) {
      if (mode === "reconcile") {
        ops.push({
          kind: "update_channel",
          channel: ch.apiName,
          parent: ch.parent,
          channel_id: liveCh.id,
          changes,
        });
      } else {
        skipped.push({
          kind: "channel",
          name: ch.apiName,
          reason: `exists but differs (${Object.keys(changes).join(", ")}); mode is create_only`,
        });
      }
    }

    const diff = diffOverwrites(ch.overwrites, liveCh.permission_overwrites);
    if (!diff.equal) {
      if (mode === "reconcile") {
        overwriteOps.push({
          kind: "set_channel_overwrites",
          channel: ch.apiName,
          parent: ch.parent,
          channel_id: liveCh.id,
          overwrites: ch.overwrites.map(readableOverwrite),
          removes: diff.removes,
        });
      } else {
        skipped.push({
          kind: "channel_overwrites",
          name: ch.apiName,
          reason: "overwrites differ from blueprint; mode is create_only",
        });
      }
    }
  };

  const overwriteOps: PlanOperation[] = [];
  const categoryCreateOps: PlanOperation[] = [];
  const channelCreateOps: PlanOperation[] = [];

  // ---- categories ----
  bp.categories.forEach((cat, index) => {
    const liveCat = liveCategoryByName.get(cat.name);
    if (!liveCat) {
      categoryCreateOps.push({
        kind: "create_category",
        category: cat.name,
        position: index,
        overwrites: cat.overwrites.map(readableOverwrite),
      });
      return;
    }
    matchedChannelIds.add(liveCat.id);
    const diff = diffOverwrites(cat.overwrites, liveCat.permission_overwrites);
    if (!diff.equal) {
      if (mode === "reconcile") {
        overwriteOps.push({
          kind: "set_channel_overwrites",
          channel: cat.name,
          parent: null,
          channel_id: liveCat.id,
          overwrites: cat.overwrites.map(readableOverwrite),
          removes: diff.removes,
        });
      } else {
        skipped.push({
          kind: "category_overwrites",
          name: cat.name,
          reason: "overwrites differ from blueprint; mode is create_only",
        });
      }
    }
  });

  // ---- channels ----
  const planChannel = (ch: NormalizedChannel, position: number): void => {
    const liveCh = liveChannelByKey.get(channelKey(ch.apiName, ch.parent));
    if (liveCh && !matchedChannelIds.has(liveCh.id)) {
      planExistingChannel(ch, liveCh);
      return;
    }
    channelCreateOps.push({
      kind: "create_channel",
      channel: ch.apiName,
      type: ch.typeName,
      parent: ch.parent,
      position,
      payload: {
        topic: ch.topic,
        nsfw: ch.nsfw,
        rate_limit_per_user: ch.rateLimitPerUser,
      },
      overwrites: ch.overwrites.map(readableOverwrite),
    });
  };

  for (const cat of bp.categories) {
    cat.channels.forEach((ch, i) => planChannel(ch, i));
  }
  bp.topLevelChannels.forEach((ch, i) => planChannel(ch, i));

  // ---- orphans ----
  const orphanRoles = live.roles
    .filter(
      (r) =>
        r.id !== live.guildId &&
        !r.managed &&
        !matchedRoleNames.has(r.name),
    )
    .map((r) => ({ id: r.id, name: r.name }));

  const orphanChannels = live.channels
    .filter((c) => !matchedChannelIds.has(c.id))
    .map((c) => ({
      id: c.id,
      name: c.name ?? "",
      type: channelTypeName(c.type),
    }));

  const operations: PlanOperation[] = [
    ...ops.filter((o) => o.kind === "update_everyone_permissions"),
    ...ops.filter((o) => o.kind === "create_role"),
    ...ops.filter((o) => o.kind === "update_role"),
    ...ops.filter((o) => o.kind === "set_role_positions"),
    ...categoryCreateOps,
    ...channelCreateOps,
    ...ops.filter((o) => o.kind === "update_channel"),
    ...overwriteOps,
    ...conflictOps,
  ];

  const creates = operations.filter((o) =>
    o.kind.startsWith("create_"),
  ).length;
  const conflicts = conflictOps.length;

  return {
    mode,
    operations,
    orphans: { roles: orphanRoles, channels: orphanChannels },
    skipped,
    warnings,
    summary: {
      operations: operations.length,
      creates,
      updates: operations.length - creates - conflicts,
      conflicts,
      skipped: skipped.length,
    },
  };
}
