/**
 * Blueprint format: a declarative description of a Discord server.
 *
 * Two layers:
 *  1. Zod schemas (structure): also exposed to MCP clients as the tool input
 *     schema, so assistants see the exact shape.
 *  2. validateBlueprint (semantics): cross-reference checks (role references,
 *     duplicates, contradictions) and normalisation into an internal model
 *     with BigInt permission bits. This runs before any API call is made.
 *
 * Roles are referenced by NAME everywhere in a blueprint. Resolution to
 * snowflake ids happens at apply time.
 */

import { z } from "zod";
import {
  PERMISSIONS,
  bitfieldToNames,
  isPermissionName,
  namesToBits,
} from "../discord/permissions.js";
import {
  CHANNEL_TYPE,
  CHANNEL_TYPE_BY_NAME,
  normalizeChannelName,
} from "../discord/types.js";

// ---------------------------------------------------------------------------
// Zod structure
// ---------------------------------------------------------------------------

const PermissionNameSchema = z
  .string()
  .describe("A Discord permission name, e.g. VIEW_CHANNEL or SEND_MESSAGES");

const RoleNameSchema = z.string().min(1).max(100);

const HexColorSchema = z
  .string()
  .regex(/^#?[0-9a-fA-F]{6}$/, 'Expected a hex color like "#e74c3c"');

export const OverwriteSpecSchema = z
  .object({
    role: RoleNameSchema.describe(
      'Role name defined in this blueprint, or "@everyone"',
    ),
    allow: z.array(PermissionNameSchema).default([]),
    deny: z.array(PermissionNameSchema).default([]),
  })
  .strict();

const ChannelTypeNameSchema = z
  .enum(["text", "voice", "announcement", "stage", "forum", "media"])
  .describe("Channel type. Categories are expressed via the categories array.");

export const ChannelSpecSchema = z
  .object({
    name: z.string().min(1).max(100),
    type: ChannelTypeNameSchema.default("text"),
    topic: z.string().max(4096).optional(),
    nsfw: z.boolean().optional(),
    rate_limit_per_user: z.number().int().min(0).max(21600).optional(),
    locked: z
      .boolean()
      .optional()
      .describe("Shorthand: deny SEND_MESSAGES for @everyone"),
    private_to: z
      .array(RoleNameSchema)
      .optional()
      .describe(
        "Shorthand: deny VIEW_CHANNEL for @everyone, allow VIEW_CHANNEL for " +
          "the listed roles. An empty array means public.",
      ),
    overwrites: z
      .array(OverwriteSpecSchema)
      .optional()
      .describe("Full escape hatch: explicit allow/deny per role"),
  })
  .strict();

export const CategorySpecSchema = z
  .object({
    name: z.string().min(1).max(100),
    private_to: z.array(RoleNameSchema).optional(),
    locked: z.boolean().optional(),
    overwrites: z.array(OverwriteSpecSchema).optional(),
    channels: z.array(ChannelSpecSchema).default([]),
  })
  .strict();

export const RoleSpecSchema = z
  .object({
    name: RoleNameSchema,
    color: HexColorSchema.optional(),
    hoist: z.boolean().optional(),
    mentionable: z.boolean().optional(),
    permissions: z.array(PermissionNameSchema).optional(),
  })
  .strict();

const AFK_TIMEOUTS = [60, 300, 900, 1800, 3600] as const;

/**
 * Structural schema for a blueprint. Used directly as the MCP tool input
 * schema; semantic checks live in validateBlueprint.
 */
export const BlueprintObjectSchema = z
  .object({
    name: z.string().min(2).max(100),
    icon: z
      .string()
      .startsWith("data:image/")
      .optional()
      .describe("Base64 data URI, e.g. data:image/png;base64,..."),
    verification_level: z.number().int().min(0).max(4).optional(),
    default_message_notifications: z.number().int().min(0).max(1).optional(),
    explicit_content_filter: z.number().int().min(0).max(2).optional(),
    afk_timeout: z
      .number()
      .int()
      .optional()
      .describe("One of 60, 300, 900, 1800, 3600 (seconds)"),
    system_channel: z
      .string()
      .optional()
      .describe("Name of a text/announcement channel defined in this blueprint"),
    afk_channel: z
      .string()
      .optional()
      .describe("Name of a voice channel defined in this blueprint"),
    everyone_permissions: z
      .array(PermissionNameSchema)
      .optional()
      .describe("Baseline permissions for the @everyone role"),
    roles: z.array(RoleSpecSchema).default([]),
    categories: z.array(CategorySpecSchema).default([]),
    channels: z
      .array(ChannelSpecSchema)
      .default([])
      .describe("Top-level channels outside any category"),
  })
  .strict();

export type Blueprint = z.output<typeof BlueprintObjectSchema>;
export type ChannelSpec = z.output<typeof ChannelSpecSchema>;
export type CategorySpec = z.output<typeof CategorySpecSchema>;
export type RoleSpec = z.output<typeof RoleSpecSchema>;
export type OverwriteSpec = z.output<typeof OverwriteSpecSchema>;

// ---------------------------------------------------------------------------
// Normalised model
// ---------------------------------------------------------------------------

export const EVERYONE = "@everyone";

export interface NormalizedOverwrite {
  /** Role name, or "@everyone". */
  role: string;
  allow: bigint;
  deny: bigint;
}

export interface NormalizedRole {
  name: string;
  /** null = not stated in the blueprint = leave unmanaged. */
  color: number | null;
  hoist: boolean | null;
  mentionable: boolean | null;
  permissions: bigint | null;
}

export interface NormalizedChannel {
  /** Name as written in the blueprint. */
  name: string;
  /** Name as Discord will store it (text-like channels get kebab-cased). */
  apiName: string;
  type: number;
  typeName: string;
  /** Category name, or null for top-level. */
  parent: string | null;
  topic: string | null;
  nsfw: boolean | null;
  rateLimitPerUser: number | null;
  /** Fully resolved overwrites (category inheritance already applied). */
  overwrites: NormalizedOverwrite[];
}

export interface NormalizedCategory {
  name: string;
  overwrites: NormalizedOverwrite[];
  channels: NormalizedChannel[];
}

export interface NormalizedBlueprint {
  name: string;
  icon: string | null;
  verificationLevel: number | null;
  defaultMessageNotifications: number | null;
  explicitContentFilter: number | null;
  afkTimeout: number | null;
  /** apiName of the referenced channel, or null. */
  systemChannelName: string | null;
  afkChannelName: string | null;
  everyonePermissions: bigint | null;
  roles: NormalizedRole[];
  categories: NormalizedCategory[];
  topLevelChannels: NormalizedChannel[];
}

export class BlueprintValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Blueprint validation failed:\n- ${issues.join("\n- ")}`);
    this.name = "BlueprintValidationError";
    this.issues = issues;
  }
}

// ---------------------------------------------------------------------------
// Validation + normalisation
// ---------------------------------------------------------------------------

interface OverwriteBits {
  allow: bigint;
  deny: bigint;
}

/**
 * Validate a raw blueprint (object or JSON string) and normalise it.
 * Throws BlueprintValidationError listing every problem found. Makes no
 * network calls; this is the "validation is a separate pass" guarantee.
 */
export function validateBlueprint(input: unknown): NormalizedBlueprint {
  let raw = input;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch (err) {
      throw new BlueprintValidationError([
        `blueprint was a string but not valid JSON: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ]);
    }
  }

  const parsed = BlueprintObjectSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BlueprintValidationError(
      parsed.error.issues.map(
        (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
      ),
    );
  }
  return normalizeBlueprint(parsed.data);
}

export function normalizeBlueprint(bp: Blueprint): NormalizedBlueprint {
  const issues: string[] = [];

  // --- roles ---
  const roleNames = new Set<string>();
  for (const [i, role] of bp.roles.entries()) {
    if (role.name === EVERYONE) {
      issues.push(
        `roles.${i}: do not define "@everyone" as a role; use everyone_permissions instead`,
      );
      continue;
    }
    if (roleNames.has(role.name)) {
      issues.push(`roles.${i}: duplicate role name "${role.name}"`);
    }
    roleNames.add(role.name);
  }

  const knownRole = (name: string): boolean =>
    name === EVERYONE || roleNames.has(name);

  const safeBits = (names: readonly string[], path: string): bigint => {
    const unknown = names.filter((n) => !isPermissionName(n));
    if (unknown.length > 0) {
      issues.push(
        `${path}: unknown permission name(s) ${unknown.join(", ")} ` +
          `(valid names: ${Object.keys(PERMISSIONS).join(", ")})`,
      );
      return 0n;
    }
    return namesToBits(names);
  };

  const roles: NormalizedRole[] = bp.roles
    .filter((r) => r.name !== EVERYONE)
    .map((r, i) => ({
      name: r.name,
      color:
        r.color !== undefined ? parseInt(r.color.replace(/^#/, ""), 16) : null,
      hoist: r.hoist ?? null,
      mentionable: r.mentionable ?? null,
      permissions:
        r.permissions !== undefined
          ? safeBits(r.permissions, `roles.${i}.permissions`)
          : null,
    }));

  const everyonePermissions =
    bp.everyone_permissions !== undefined
      ? safeBits(bp.everyone_permissions, "everyone_permissions")
      : null;

  // --- overwrite building ---

  const buildOwnOverwrites = (
    spec: {
      private_to?: string[] | undefined;
      locked?: boolean | undefined;
      overwrites?: OverwriteSpec[] | undefined;
    },
    path: string,
  ): Map<string, OverwriteBits> => {
    const map = new Map<string, OverwriteBits>();
    const entry = (role: string): OverwriteBits => {
      let e = map.get(role);
      if (!e) {
        e = { allow: 0n, deny: 0n };
        map.set(role, e);
      }
      return e;
    };

    if (spec.private_to !== undefined && spec.private_to.length > 0) {
      entry(EVERYONE).deny |= PERMISSIONS.VIEW_CHANNEL;
      for (const roleName of spec.private_to) {
        if (roleName === EVERYONE) {
          issues.push(
            `${path}.private_to: "@everyone" makes no sense here; omit private_to (or use []) for a public channel`,
          );
          continue;
        }
        if (!knownRole(roleName)) {
          issues.push(
            `${path}.private_to: role "${roleName}" is not defined in roles[]`,
          );
          continue;
        }
        entry(roleName).allow |= PERMISSIONS.VIEW_CHANNEL;
      }
    }

    if (spec.locked === true) {
      entry(EVERYONE).deny |= PERMISSIONS.SEND_MESSAGES;
    }

    for (const [i, ow] of (spec.overwrites ?? []).entries()) {
      if (!knownRole(ow.role)) {
        issues.push(
          `${path}.overwrites.${i}: role "${ow.role}" is not defined in roles[]`,
        );
        continue;
      }
      const e = entry(ow.role);
      e.allow |= safeBits(ow.allow, `${path}.overwrites.${i}.allow`);
      e.deny |= safeBits(ow.deny, `${path}.overwrites.${i}.deny`);
    }

    // Contradictions within one level are author errors.
    for (const [role, bits] of map) {
      const both = bits.allow & bits.deny;
      if (both !== 0n) {
        issues.push(
          `${path}: overwrites for "${role}" both allow and deny ${bitfieldToNames(
            both.toString(),
          ).join(", ")}`,
        );
      }
    }
    return map;
  };

  /**
   * Category overwrites inherit to child channels unless the child overrides.
   * A child with no overwrite-affecting fields is an exact copy (synced, the
   * way Discord's own UI syncs new channels to their category). A child that
   * states anything merges per role and per bit, with the child winning on
   * conflicts -- so `locked` inside a private category keeps the privacy and
   * adds the lock.
   */
  const mergeInherited = (
    cat: Map<string, OverwriteBits>,
    own: Map<string, OverwriteBits>,
  ): NormalizedOverwrite[] => {
    if (own.size === 0) return finishOverwrites(cat);
    const merged = new Map<string, OverwriteBits>();
    for (const [role, bits] of cat) {
      merged.set(role, { allow: bits.allow, deny: bits.deny });
    }
    for (const [role, child] of own) {
      const base = merged.get(role) ?? { allow: 0n, deny: 0n };
      merged.set(role, {
        allow: (base.allow & ~child.deny) | child.allow,
        deny: (base.deny & ~child.allow) | child.deny,
      });
    }
    return finishOverwrites(merged);
  };

  const finishOverwrites = (
    map: Map<string, OverwriteBits>,
  ): NormalizedOverwrite[] => {
    const list: NormalizedOverwrite[] = [];
    for (const [role, bits] of map) {
      if (bits.allow === 0n && bits.deny === 0n) continue;
      list.push({ role, allow: bits.allow, deny: bits.deny });
    }
    list.sort((a, b) => {
      if (a.role === EVERYONE) return -1;
      if (b.role === EVERYONE) return 1;
      return a.role.localeCompare(b.role);
    });
    return list;
  };

  // --- channels ---

  const channelKeys = new Set<string>();
  const allChannels: NormalizedChannel[] = [];

  const normalizeChannel = (
    spec: ChannelSpec,
    parent: string | null,
    catMap: Map<string, OverwriteBits>,
    path: string,
  ): NormalizedChannel => {
    const type = CHANNEL_TYPE_BY_NAME[spec.type];
    const apiName = normalizeChannelName(type, spec.name);
    if (apiName.length === 0) {
      issues.push(
        `${path}.name: "${spec.name}" normalises to an empty channel name`,
      );
    }
    const key = `${parent ?? ""}|${apiName}`;
    if (channelKeys.has(key)) {
      issues.push(
        `${path}: duplicate channel name "${apiName}" ${
          parent ? `in category "${parent}"` : "at top level"
        }`,
      );
    }
    channelKeys.add(key);

    const own = buildOwnOverwrites(spec, path);
    const channel: NormalizedChannel = {
      name: spec.name,
      apiName,
      type,
      typeName: spec.type,
      parent,
      topic: spec.topic ?? null,
      nsfw: spec.nsfw ?? null,
      rateLimitPerUser: spec.rate_limit_per_user ?? null,
      overwrites: mergeInherited(catMap, own),
    };
    allChannels.push(channel);
    return channel;
  };

  const categoryNames = new Set<string>();
  const categories: NormalizedCategory[] = bp.categories.map((cat, i) => {
    const name = cat.name.trim();
    if (categoryNames.has(name)) {
      issues.push(`categories.${i}: duplicate category name "${name}"`);
    }
    categoryNames.add(name);
    const catMap = buildOwnOverwrites(cat, `categories.${i}`);
    return {
      name,
      overwrites: finishOverwrites(catMap),
      channels: cat.channels.map((ch, j) =>
        normalizeChannel(ch, name, catMap, `categories.${i}.channels.${j}`),
      ),
    };
  });

  const topLevelChannels: NormalizedChannel[] = bp.channels.map((ch, j) =>
    normalizeChannel(ch, null, new Map(), `channels.${j}`),
  );

  // --- special channel references ---

  const resolveChannelRef = (
    ref: string | undefined,
    field: string,
    allowedTypes: number[],
    typeLabel: string,
  ): string | null => {
    if (ref === undefined) return null;
    const matches = allChannels.filter(
      (c) => c.name === ref || c.apiName === ref,
    );
    if (matches.length === 0) {
      issues.push(`${field}: no channel named "${ref}" in this blueprint`);
      return null;
    }
    const match = matches[0];
    if (!match) return null;
    if (matches.length > 1) {
      issues.push(
        `${field}: channel name "${ref}" is ambiguous (${matches.length} matches)`,
      );
      return null;
    }
    if (!allowedTypes.includes(match.type)) {
      issues.push(`${field}: channel "${ref}" must be a ${typeLabel} channel`);
      return null;
    }
    return match.apiName;
  };

  const systemChannelName = resolveChannelRef(
    bp.system_channel,
    "system_channel",
    [CHANNEL_TYPE.GUILD_TEXT, CHANNEL_TYPE.GUILD_ANNOUNCEMENT],
    "text or announcement",
  );
  const afkChannelName = resolveChannelRef(
    bp.afk_channel,
    "afk_channel",
    [CHANNEL_TYPE.GUILD_VOICE],
    "voice",
  );

  if (
    bp.afk_timeout !== undefined &&
    !AFK_TIMEOUTS.includes(bp.afk_timeout as (typeof AFK_TIMEOUTS)[number])
  ) {
    issues.push(
      `afk_timeout: must be one of ${AFK_TIMEOUTS.join(", ")} (seconds)`,
    );
  }

  if (issues.length > 0) {
    throw new BlueprintValidationError(issues);
  }

  return {
    name: bp.name,
    icon: bp.icon ?? null,
    verificationLevel: bp.verification_level ?? null,
    defaultMessageNotifications: bp.default_message_notifications ?? null,
    explicitContentFilter: bp.explicit_content_filter ?? null,
    afkTimeout: bp.afk_timeout ?? null,
    systemChannelName,
    afkChannelName,
    everyonePermissions,
    roles,
    categories,
    topLevelChannels,
  };
}

/** Human-readable form of a normalised overwrite, for plan output. */
export function readableOverwrite(ow: NormalizedOverwrite): {
  role: string;
  allow: string[];
  deny: string[];
} {
  return {
    role: ow.role,
    allow: bitfieldToNames(ow.allow.toString()),
    deny: bitfieldToNames(ow.deny.toString()),
  };
}
