/**
 * Pure computation of Discord's effective-permission precedence for a member
 * (or a hypothetical role set) at server level and, optionally, at channel
 * level.
 *
 * Algorithm (matches Discord's documented permission hierarchy):
 * 1. Base = OR of @everyone's permissions and every held role's permissions.
 * 2. If the combined base includes ADMINISTRATOR, every permission is
 *    granted and every overwrite is bypassed, at both server and channel
 *    level -- the rest of the computation is skipped.
 * 3. Otherwise, for a channel: start from the base, apply the parent
 *    category's overwrites as one layer (if any), then apply the channel's
 *    own overwrites as a second layer on top. Each layer applies, in order:
 *    the @everyone overwrite (deny then allow), the union of all applicable
 *    role overwrites (all applicable denies unioned and removed, then all
 *    applicable allows unioned and added), and finally a member-specific
 *    overwrite (deny then allow) when a concrete member (not a hypothetical
 *    role set) is being evaluated.
 *
 * No network I/O; takes already-fetched Discord objects so it is trivial to
 * unit test exhaustively.
 */

import {
  ALL_PERMISSIONS_BITS,
  PERMISSIONS,
  bitfieldToNames,
  parseBitfield,
} from "./permissions.js";
import type { APIChannel, APIOverwrite, APIRole } from "./types.js";

export interface EffectivePermissionsInput {
  /** Every role in the guild (used to resolve the @everyone base and names/positions). */
  roles: readonly APIRole[];
  /** The @everyone role's id -- always equal to the guild id. */
  everyoneRoleId: string;
  /** Role ids held by the member, or the hypothetical role set being evaluated. Never include @everyone here. */
  roleIds: readonly string[];
  /**
   * The concrete member id being evaluated, if any. When present, a
   * member-specific channel overwrite is considered. Absent in "role set"
   * mode, where there is no concrete member to target.
   */
  memberId?: string;
  /** Target channel, if channel-level permissions are wanted. */
  channel?: Pick<APIChannel, "id" | "permission_overwrites">;
  /** The channel's parent category, if it has one and it was resolved. */
  category?: Pick<APIChannel, "id" | "permission_overwrites">;
}

export interface ContributingRole {
  id: string;
  name: string;
  position: number;
}

export interface EffectivePermissionsResult {
  administrator: boolean;
  server_bitfield: string;
  server_permissions: string[];
  /** null when no channel was supplied. */
  channel_bitfield: string | null;
  channel_permissions: string[] | null;
  contributing_roles: ContributingRole[];
  /** Human-readable trace of how the result was derived, in order applied. */
  reasoning: string[];
}

function applyOverwriteLayer(
  base: bigint,
  overwrites: readonly APIOverwrite[] | undefined,
  everyoneRoleId: string,
  roleIds: ReadonlySet<string>,
  memberId: string | undefined,
  layerLabel: string,
  reasoning: string[],
): bigint {
  if (!overwrites || overwrites.length === 0) return base;
  let perms = base;

  const everyoneOw = overwrites.find(
    (ow) => ow.type === 0 && ow.id === everyoneRoleId,
  );
  if (everyoneOw) {
    const deny = parseBitfield(everyoneOw.deny);
    const allow = parseBitfield(everyoneOw.allow);
    perms = (perms & ~deny) | allow;
    reasoning.push(`${layerLabel}: @everyone overwrite applied (deny, then allow)`);
  }

  const roleOws = overwrites.filter(
    (ow) => ow.type === 0 && ow.id !== everyoneRoleId && roleIds.has(ow.id),
  );
  if (roleOws.length > 0) {
    let denyUnion = 0n;
    let allowUnion = 0n;
    for (const ow of roleOws) {
      denyUnion |= parseBitfield(ow.deny);
      allowUnion |= parseBitfield(ow.allow);
    }
    perms = (perms & ~denyUnion) | allowUnion;
    reasoning.push(
      `${layerLabel}: ${roleOws.length} role overwrite(s) applied ` +
        "(all denies unioned and removed, then all allows unioned and added)",
    );
  }

  if (memberId) {
    const memberOw = overwrites.find(
      (ow) => ow.type === 1 && ow.id === memberId,
    );
    if (memberOw) {
      const deny = parseBitfield(memberOw.deny);
      const allow = parseBitfield(memberOw.allow);
      perms = (perms & ~deny) | allow;
      reasoning.push(
        `${layerLabel}: member-specific overwrite applied (deny, then allow)`,
      );
    }
  }

  return perms;
}

export function computeEffectivePermissions(
  input: EffectivePermissionsInput,
): EffectivePermissionsResult {
  const reasoning: string[] = [];
  const roleIdSet = new Set(input.roleIds);

  const everyone = input.roles.find((r) => r.id === input.everyoneRoleId);
  let base = everyone ? parseBitfield(everyone.permissions) : 0n;
  reasoning.push("Base permissions start from the @everyone role");

  const contributing = input.roles.filter((r) => roleIdSet.has(r.id));
  for (const role of contributing) {
    base |= parseBitfield(role.permissions);
  }
  if (contributing.length > 0) {
    reasoning.push(
      `Combined (OR) ${contributing.length} held role(s): ` +
        contributing.map((r) => r.name).join(", "),
    );
  }

  const administrator =
    (base & PERMISSIONS.ADMINISTRATOR) === PERMISSIONS.ADMINISTRATOR;
  if (administrator) {
    reasoning.push(
      "ADMINISTRATOR is present on the combined role set: every permission " +
        "is granted and every overwrite (category and channel) is bypassed",
    );
  }

  const serverBits = administrator ? ALL_PERMISSIONS_BITS : base;

  let channelBits: bigint | null = null;
  if (input.channel) {
    if (administrator) {
      channelBits = ALL_PERMISSIONS_BITS;
    } else {
      let working = base;
      if (input.category) {
        working = applyOverwriteLayer(
          working,
          input.category.permission_overwrites,
          input.everyoneRoleId,
          roleIdSet,
          input.memberId,
          "Category overwrite layer",
          reasoning,
        );
      }
      working = applyOverwriteLayer(
        working,
        input.channel.permission_overwrites,
        input.everyoneRoleId,
        roleIdSet,
        input.memberId,
        "Channel overwrite layer",
        reasoning,
      );
      channelBits = working;
    }
  }

  return {
    administrator,
    server_bitfield: serverBits.toString(),
    server_permissions: bitfieldToNames(serverBits.toString()),
    channel_bitfield: channelBits !== null ? channelBits.toString() : null,
    channel_permissions:
      channelBits !== null ? bitfieldToNames(channelBits.toString()) : null,
    contributing_roles: [...contributing]
      .sort((a, b) => b.position - a.position)
      .map((r) => ({ id: r.id, name: r.name, position: r.position })),
    reasoning,
  };
}
