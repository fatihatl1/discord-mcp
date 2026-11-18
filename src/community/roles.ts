/**
 * Phase 5 community-segmentation role vocabulary.
 *
 * Discord permissions are purely additive: there is no native way to express
 * "Member AND RU". The BULLHAUS model therefore splits identity from access:
 *
 *   - A PUBLIC cohort role (BULLHAUS / RU / F3NTM) says which community a
 *     user came from. It carries no permissions at all and grants no
 *     VIEW_CHANNEL anywhere, so a role-assigning invite can hand it out at
 *     join time without exposing anything.
 *   - A verified user carries MEMBER.
 *   - An INTERNAL access role (Access-BULLHAUS / Access-RU / Access-F3NTM) is
 *     what the category overwrites actually key on. Nothing hands it out by
 *     hand; the role-sync worker grants it exactly while the user holds BOTH
 *     Member and the matching cohort role, and takes it back the moment
 *     either prerequisite disappears.
 *
 * The badge roles (Trading / Gaming) are deliberately absent from this file:
 * they are cosmetic only and must never take part in an access calculation.
 */

/** The base verified role. Without it no cohort unlocks anything. */
export const MEMBER_ROLE_NAME = "Member";

export interface CohortDefinition {
  /** Public, invite-assignable identity role. Never grants visibility. */
  readonly cohortRoleName: string;
  /** Internal role the category overwrites key on. Worker-managed only. */
  readonly accessRoleName: string;
}

export const COHORTS: readonly CohortDefinition[] = Object.freeze([
  Object.freeze({ cohortRoleName: "BULLHAUS", accessRoleName: "Access-BULLHAUS" }),
  Object.freeze({ cohortRoleName: "RU", accessRoleName: "Access-RU" }),
  Object.freeze({ cohortRoleName: "F3NTM", accessRoleName: "Access-F3NTM" }),
]);

/**
 * Cosmetic badge roles. Listed only so the worker's own safety assertions can
 * name them as roles it must never touch; no code may branch on them.
 */
export const BADGE_ROLE_NAMES: readonly string[] = Object.freeze([
  "Trading",
  "Gaming",
]);

/** Scoped moderation roles. The worker never reads or writes these either. */
export const SCOPED_ADMIN_ROLE_NAMES: readonly string[] = Object.freeze([
  "Admin-BULLHAUS",
  "Admin-RU",
  "Admin-F3NTM",
]);

/** The only role names the worker is ever permitted to add or remove. */
export const WORKER_WRITABLE_ROLE_NAMES: readonly string[] = Object.freeze(
  COHORTS.map((c) => c.accessRoleName),
);
