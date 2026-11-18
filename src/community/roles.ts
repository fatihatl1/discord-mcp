/**
 * Phase 5.2 community role vocabulary.
 *
 * Phase 5 split identity (BULLHAUS / RU / F3NTM) from access (the internal
 * Access-* roles) because Discord permissions are additive and cannot
 * express "Member AND RU" as a single channel-overwrite condition. Phase 5.1
 * removed that internal layer: the community roles key the category
 * overwrites DIRECTLY, and the "Member AND cohort" gate became an
 * OPERATIONAL rule instead of a technical one -- these roles are assigned by
 * an Admin, by hand, only after verification already granted MEMBER
 * (Section 42's ticket-based process), never by an automatic invite.
 *
 * Phase 5.2 changed which roles carry real community visibility: TRADING and
 * GAMING became access roles (same visibility as DVVV / F3NTM respectively),
 * while INNERCIRCLE became a pure cosmetic badge (VIP's existing role, no
 * change). MEMBERSHIP_GATED_ROLE_NAMES / BADGE_ROLE_NAMES below move with
 * that: a role is gated exactly when holding it alone grants visibility
 * Discord cannot additionally condition on MEMBER.
 *
 * MEMBERSHIP_GATED_ROLE_NAMES exists so a lightweight, READ-ONLY audit (see
 * membership_guard.ts) can flag the rare case where the operational rule
 * was not followed -- a human somehow holding a gated role without MEMBER --
 * for a person to review. It never writes a role itself: Section 13 (Phase
 * 5.1) / Section 12 (Phase 5.2) explicitly ask for the safe (reporting)
 * version, not an automatic corrector, "if this cannot be done reliably
 * without destructive behavior." Automatically revoking a community or
 * admin role is exactly that kind of irreversible-in-spirit action, so this
 * file only reports.
 */

/** The base verified role. Every gated role below is meaningless without it. */
export const MEMBER_ROLE_NAME = "MEMBER";

/**
 * Community and scoped-admin roles that should only ever be held alongside
 * MEMBER. OWNER is deliberately absent -- it is exempt, since OWNER must
 * always retain full emergency control regardless of MEMBER.
 */
export const MEMBERSHIP_GATED_ROLE_NAMES: readonly string[] = Object.freeze([
  "F3NTM",
  "BULLHAUS",
  "DVVV",
  "TRADING",
  "GAMING",
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
export const BADGE_ROLE_NAMES: readonly string[] = Object.freeze(["INNERCIRCLE", "VIP"]);
