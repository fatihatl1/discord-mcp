/**
 * Phase 5.1 community role vocabulary.
 *
 * Phase 5 split identity (BULLHAUS / RU / F3NTM) from access (the internal
 * Access-* roles) because Discord permissions are additive and cannot
 * express "Member AND RU" as a single channel-overwrite condition. Phase 5.1
 * removes that internal layer: the community roles (F3NTM / BULLHAUS / DVVV
 * / INNERCIRCLE / COACH) key the category overwrites DIRECTLY now, and the
 * "Member AND cohort" gate becomes an OPERATIONAL rule instead of a technical
 * one -- these roles are assigned by an Admin, by hand, only after
 * verification already granted MEMBER (Section 42's ticket-based process),
 * never by an automatic invite.
 *
 * MEMBERSHIP_GATED_ROLE_NAMES exists so a lightweight, READ-ONLY audit (see
 * membership_guard.ts) can flag the rare case where that operational rule
 * was not followed -- a human somehow holding one of these roles without
 * MEMBER -- for a person to review. It never writes a role itself: Section
 * 13 explicitly asks for the safe (reporting) version, not an automatic
 * corrector, "if this cannot be done reliably without destructive
 * behavior." Automatically revoking a community or admin role is exactly
 * that kind of irreversible-in-spirit action, so this file only reports.
 */

/** The base verified role. Every gated role below is meaningless without it. */
export const MEMBER_ROLE_NAME = "MEMBER";

/**
 * Community and scoped-admin roles that should only ever be held alongside
 * MEMBER. OWNER is deliberately absent -- Section 7/62 exempts it, since
 * OWNER must always retain full emergency control regardless of MEMBER.
 */
export const MEMBERSHIP_GATED_ROLE_NAMES: readonly string[] = Object.freeze([
  "F3NTM",
  "BULLHAUS",
  "DVVV",
  "INNERCIRCLE",
  "COACH",
  "ADMIN-GLOBAL",
  "ADMIN-BULLHAUS",
  "ADMIN-RU",
  "ADMIN-GAMING",
]);

/**
 * Cosmetic badge roles. Listed only so tests and the audit's own assertions
 * can confirm they are never treated as gated; no code may branch on them.
 */
export const BADGE_ROLE_NAMES: readonly string[] = Object.freeze(["TRADING", "GAMING", "VIP"]);
