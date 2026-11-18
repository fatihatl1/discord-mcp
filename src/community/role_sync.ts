/**
 * Community role-sync worker: keeps each Access-* role exactly in step with
 * "member holds Member AND the matching cohort role".
 *
 * Shape: a PURE planner (`planRoleSync`) that turns a member roster into a
 * list of operations, and a thin executor (`executeRoleSync`) that applies
 * them. All the interesting logic lives in the pure half so it can be tested
 * without a network, and the executor stays small enough to audit by eye.
 *
 * Safety posture -- the worker runs unattended on a 5-minute schedule, so
 * every guard fails CLOSED:
 *  - Role resolution is by exact name and throws if ANY required role is
 *    missing, rather than silently planning a partial sync.
 *  - The executor re-checks every operation against an allow-list of Access-*
 *    role ids BEFORE issuing any write, and throws if an operation names
 *    anything else. Member, the cohort roles, the badge roles, Admin, Owner,
 *    VIP, Inner Circle, Coach and every bot role are therefore unreachable
 *    even if the planner were wrong.
 *  - Bots are skipped entirely.
 *  - Duplicate operations are rejected, so one pass can never issue two
 *    writes for the same (user, role).
 *  - Dry-run performs zero writes.
 *  - The first Discord API error stops the pass; remaining operations are
 *    reported as not-applied rather than retried blindly.
 */

import type { DiscordApi } from "../discord/endpoints.js";
import type { APIGuildMember, APIRole } from "../discord/types.js";
import { COHORTS, MEMBER_ROLE_NAME } from "./roles.js";

export class RoleSyncConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoleSyncConfigError";
  }
}

export class RoleSyncSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoleSyncSafetyError";
  }
}

export interface ResolvedCohort {
  readonly name: string;
  readonly cohortRoleId: string;
  readonly accessRoleId: string;
}

export interface ResolvedRoles {
  readonly memberRoleId: string;
  readonly cohorts: readonly ResolvedCohort[];
  /** The complete set of role ids the executor is allowed to write. */
  readonly writableRoleIds: ReadonlySet<string>;
}

/**
 * Map role names to live ids. Throws RoleSyncConfigError listing every
 * missing name, so a half-provisioned guild stops the worker instead of
 * producing a sync that silently ignores one cohort.
 */
export function resolveRoles(roles: readonly APIRole[]): ResolvedRoles {
  const byName = new Map<string, APIRole[]>();
  for (const role of roles) {
    const list = byName.get(role.name);
    if (list) list.push(role);
    else byName.set(role.name, [role]);
  }

  const missing: string[] = [];
  const ambiguous: string[] = [];
  const idOf = (name: string): string | undefined => {
    const found = byName.get(name);
    if (!found || found.length === 0) {
      missing.push(name);
      return undefined;
    }
    if (found.length > 1) {
      ambiguous.push(name);
      return undefined;
    }
    return found[0]?.id;
  };

  const memberRoleId = idOf(MEMBER_ROLE_NAME);
  const cohorts: ResolvedCohort[] = [];
  for (const cohort of COHORTS) {
    const cohortRoleId = idOf(cohort.cohortRoleName);
    const accessRoleId = idOf(cohort.accessRoleName);
    if (cohortRoleId && accessRoleId) {
      cohorts.push({ name: cohort.cohortRoleName, cohortRoleId, accessRoleId });
    }
  }

  if (missing.length > 0 || ambiguous.length > 0) {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`missing role(s): ${missing.join(", ")}`);
    if (ambiguous.length > 0) {
      parts.push(
        `duplicate role name(s), which make the mapping ambiguous: ${ambiguous.join(", ")}`,
      );
    }
    throw new RoleSyncConfigError(
      `Cannot resolve the community role model -- ${parts.join("; ")}. ` +
        "Refusing to sync rather than acting on a partial mapping.",
    );
  }

  return {
    memberRoleId: memberRoleId as string,
    cohorts,
    writableRoleIds: new Set(cohorts.map((c) => c.accessRoleId)),
  };
}

export type SyncOpKind = "add" | "remove";

export interface SyncOp {
  readonly kind: SyncOpKind;
  readonly userId: string;
  readonly username: string;
  readonly cohort: string;
  readonly roleId: string;
  readonly roleName: string;
  /** Human-readable justification, reused as the Discord audit-log reason. */
  readonly reason: string;
}

/**
 * Decide the operations that bring the roster in line with the model.
 * Pure: no I/O, no clock, no randomness, so a second call on unchanged input
 * returns an empty plan (idempotence is a property of this function, not of
 * the executor).
 */
export function planRoleSync(
  members: readonly APIGuildMember[],
  resolved: ResolvedRoles,
): SyncOp[] {
  const ops: SyncOp[] = [];

  for (const member of members) {
    const user = member.user;
    // A member entry with no user object cannot be acted on; and bots are
    // service identities that are never part of the community cohort model.
    if (!user?.id || user.bot === true) continue;

    const held = new Set(member.roles);
    const hasMember = held.has(resolved.memberRoleId);

    for (const cohort of resolved.cohorts) {
      const hasCohort = held.has(cohort.cohortRoleId);
      const hasAccess = held.has(cohort.accessRoleId);
      const shouldHaveAccess = hasMember && hasCohort;

      if (shouldHaveAccess && !hasAccess) {
        ops.push({
          kind: "add",
          userId: user.id,
          username: user.username,
          cohort: cohort.name,
          roleId: cohort.accessRoleId,
          roleName: `Access-${cohort.name}`,
          reason: `holds ${MEMBER_ROLE_NAME} + ${cohort.name}`,
        });
      } else if (!shouldHaveAccess && hasAccess) {
        const lost = !hasMember
          ? !hasCohort
            ? `${MEMBER_ROLE_NAME} and ${cohort.name}`
            : MEMBER_ROLE_NAME
          : cohort.name;
        ops.push({
          kind: "remove",
          userId: user.id,
          username: user.username,
          cohort: cohort.name,
          roleId: cohort.accessRoleId,
          roleName: `Access-${cohort.name}`,
          reason: `no longer holds ${lost}`,
        });
      }
    }
  }

  return ops;
}

export interface ExecuteOptions {
  readonly guildId: string;
  readonly dryRun: boolean;
  /** Only these role ids may be written. Anything else aborts the pass. */
  readonly writableRoleIds: ReadonlySet<string>;
}

export interface ExecuteResult {
  readonly dryRun: boolean;
  readonly planned: readonly SyncOp[];
  readonly applied: readonly SyncOp[];
  /** Operations not attempted because an earlier one failed. */
  readonly notAttempted: readonly SyncOp[];
  readonly failure?: { readonly op: SyncOp; readonly message: string };
}

/**
 * Apply a plan. Every write is routed through addMemberRole/removeMemberRole,
 * which are idempotent server-side, so a replayed plan cannot corrupt state.
 */
export async function executeRoleSync(
  api: DiscordApi,
  ops: readonly SyncOp[],
  opts: ExecuteOptions,
): Promise<ExecuteResult> {
  // --- Guards run over the WHOLE plan before the first write, so a bad plan
  // --- never gets partially applied. ---
  const seen = new Set<string>();
  for (const op of ops) {
    if (!opts.writableRoleIds.has(op.roleId)) {
      throw new RoleSyncSafetyError(
        `Refusing to ${op.kind} role ${op.roleId} ("${op.roleName}") on user ` +
          `${op.userId}: the worker may only write the Access-* roles ` +
          `[${[...opts.writableRoleIds].join(", ")}]. No write was performed.`,
      );
    }
    const key = `${op.userId}:${op.roleId}`;
    if (seen.has(key)) {
      throw new RoleSyncSafetyError(
        `Refusing to run a plan containing two operations for user ` +
          `${op.userId} and role ${op.roleId} ("${op.roleName}"). ` +
          "No write was performed.",
      );
    }
    seen.add(key);
  }

  if (opts.dryRun) {
    return { dryRun: true, planned: ops, applied: [], notAttempted: ops };
  }

  const applied: SyncOp[] = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (!op) continue;
    const reason = `community-role-sync: ${op.kind} ${op.roleName} -- ${op.reason}`;
    try {
      if (op.kind === "add") {
        await api.addMemberRole(opts.guildId, op.userId, op.roleId, reason);
      } else {
        await api.removeMemberRole(opts.guildId, op.userId, op.roleId, reason);
      }
      applied.push(op);
    } catch (err) {
      // Stop safely: do not keep hammering an API that just refused us.
      return {
        dryRun: false,
        planned: ops,
        applied,
        notAttempted: ops.slice(i),
        failure: { op, message: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  return { dryRun: false, planned: ops, applied, notAttempted: [] };
}

/** Page through every guild member (1000 per request). */
export async function fetchAllMembers(
  api: DiscordApi,
  guildId: string,
): Promise<APIGuildMember[]> {
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

export interface RunResult extends ExecuteResult {
  readonly membersScanned: number;
  readonly humansScanned: number;
}

/** One full pass: read roles + members, plan, execute. */
export async function runRoleSync(
  api: DiscordApi,
  guildId: string,
  opts: { dryRun: boolean },
): Promise<RunResult> {
  const roles = await api.listGuildRoles(guildId);
  const resolved = resolveRoles(roles);
  const members = await fetchAllMembers(api, guildId);
  const humans = members.filter((m) => m.user && m.user.bot !== true);
  const ops = planRoleSync(members, resolved);
  const result = await executeRoleSync(api, ops, {
    guildId,
    dryRun: opts.dryRun,
    writableRoleIds: resolved.writableRoleIds,
  });
  return { ...result, membersScanned: members.length, humansScanned: humans.length };
}
