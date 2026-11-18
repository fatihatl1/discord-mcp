/**
 * Membership guard: a READ-ONLY audit of the "community/admin roles are
 * assigned only after MEMBER" operational rule (Section 11/13/42).
 *
 * Phase 5 enforced this rule technically, with an internal Access-* role
 * layer a worker kept in sync. Phase 5.1 removes that layer -- the community
 * roles now key the category overwrites directly -- and the rule becomes
 * operational: an Admin assigns F3NTM / BULLHAUS / DVVV by hand, through a
 * support ticket, only once MEMBER already exists. There is nothing left
 * for an automated worker to safely WRITE: the roles it would need to touch
 * (community identity, scoped admin) are exactly the ones a human assigned
 * on purpose, and Section 13 is explicit that an automatic corrector for
 * this is "destructive behavior" to avoid deploying unless it can be done
 * reliably. It cannot, in general -- an Admin may have a legitimate reason
 * a human temporarily lacks MEMBER (a verification re-run, a moderation
 * action) while still intending them to keep their community role.
 *
 * So this module only ever REPORTS. `auditMembership` is a pure function
 * (no I/O); `runMembershipGuard` fetches the roster and calls it. Neither
 * one calls addMemberRole / removeMemberRole / modifyRole, and there is no
 * executor to call them even if invoked incorrectly from a workflow.
 */

import type { DiscordApi } from "../discord/endpoints.js";
import type { APIGuildMember, APIRole } from "../discord/types.js";
import { MEMBER_ROLE_NAME, MEMBERSHIP_GATED_ROLE_NAMES } from "./roles.js";

export class MembershipGuardConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MembershipGuardConfigError";
  }
}

export interface ResolvedGuardRoles {
  readonly memberRoleId: string;
  /** Gated role id -> its name, for roles actually present live. */
  readonly gatedRoles: ReadonlyMap<string, string>;
}

/**
 * Resolve role names to ids. Fails closed: throws naming every missing
 * role rather than silently auditing a partial set. MEMBER must exist;
 * individual gated roles that do not exist live are simply skipped (a role
 * renamed or not yet created should not stop the whole audit).
 */
export function resolveGuardRoles(roles: readonly APIRole[]): ResolvedGuardRoles {
  const byName = new Map(roles.map((r) => [r.name, r] as const));
  const member = byName.get(MEMBER_ROLE_NAME);
  if (!member) {
    throw new MembershipGuardConfigError(
      `Cannot audit membership -- role "${MEMBER_ROLE_NAME}" does not exist live.`,
    );
  }
  const gatedRoles = new Map<string, string>();
  for (const name of MEMBERSHIP_GATED_ROLE_NAMES) {
    const role = byName.get(name);
    if (role) gatedRoles.set(role.id, name);
  }
  return { memberRoleId: member.id, gatedRoles };
}

export interface MembershipViolation {
  readonly userId: string;
  readonly username: string;
  /** Gated role names this human holds without MEMBER. */
  readonly rolesHeldWithoutMember: readonly string[];
}

/**
 * Pure: find every human who holds a gated role without MEMBER. Bots are
 * always skipped -- they are never part of this community/admin model.
 * A member entry with no user object is skipped (nothing to act on).
 */
export function auditMembership(
  members: readonly APIGuildMember[],
  resolved: ResolvedGuardRoles,
): MembershipViolation[] {
  const violations: MembershipViolation[] = [];

  for (const member of members) {
    const user = member.user;
    if (!user?.id || user.bot === true) continue;

    const held = new Set(member.roles);
    if (held.has(resolved.memberRoleId)) continue; // has MEMBER: nothing to flag

    const gatedHeld = [...held]
      .map((id) => resolved.gatedRoles.get(id))
      .filter((name): name is string => name !== undefined);

    if (gatedHeld.length > 0) {
      violations.push({ userId: user.id, username: user.username, rolesHeldWithoutMember: gatedHeld });
    }
  }

  return violations;
}

/** Page through every guild member (1000 per request). */
export async function fetchAllMembers(api: DiscordApi, guildId: string): Promise<APIGuildMember[]> {
  const all: APIGuildMember[] = [];
  let after: string | undefined;
  for (let page = 0; page < 50; page++) {
    const query = after === undefined ? { limit: 1000 } : { limit: 1000, after };
    const batch = await api.listGuildMembers(guildId, query);
    all.push(...batch);
    if (batch.length < 1000) break;
    const last = batch[batch.length - 1];
    if (!last?.user?.id) break;
    after = last.user.id;
  }
  return all;
}

export interface GuardRunResult {
  readonly membersScanned: number;
  readonly humansScanned: number;
  readonly violations: readonly MembershipViolation[];
}

/** One full read-only pass: fetch roles + members, then audit. No writes. */
export async function runMembershipGuard(api: DiscordApi, guildId: string): Promise<GuardRunResult> {
  const roles = await api.listGuildRoles(guildId);
  const resolved = resolveGuardRoles(roles);
  const members = await fetchAllMembers(api, guildId);
  const humans = members.filter((m) => m.user && m.user.bot !== true);
  const violations = auditMembership(members, resolved);
  return { membersScanned: members.length, humansScanned: humans.length, violations };
}
