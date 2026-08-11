/**
 * Opinionated Discord server design guide, exposed as an MCP resource and
 * embedded in the design_server prompt so assistants produce sensible
 * layouts instead of inventing conventions per request.
 */

export const DESIGN_GUIDE_URI = "discord://design-guide";

export const DESIGN_GUIDE = `# Discord server design guide

Conventions for laying out a Discord server that feels professional. Use
these when composing a blueprint for apply_blueprint or create_guild.

## Category order (top to bottom)

1. INFORMATION first: rules and announcements, both locked (read-only).
   This is the first thing new members see.
2. General/social text channels next: general, off-topic, media.
3. Topic or purpose areas after that (game areas, help, projects).
4. Voice channels near the bottom, in their own category.
5. STAFF last, private to staff roles.

Name categories in CAPS ("INFORMATION", "STAFF"); Discord renders them as
section headers. Text channel names are lowercase-kebab automatically.

## Standard channels almost every server wants

- rules (text, locked) and announcements (announcement type, locked) in
  INFORMATION.
- welcome or general as the landing channel.
- A staff-chat plus a mod-log, both private to staff.
- Keep the total small: 10-20 channels. Empty channels make a server feel
  dead; add more only when activity demands it.

## Role ladder

Top to bottom (blueprint roles order is top-first):

1. Admin -- ADMINISTRATOR, hoisted. Owner-trusted people only.
2. Mod -- moderation set, hoisted: KICK_MEMBERS, BAN_MEMBERS,
   MODERATE_MEMBERS, MANAGE_MESSAGES, MANAGE_NICKNAMES, VIEW_AUDIT_LOG,
   MUTE_MEMBERS, DEAFEN_MEMBERS, MOVE_MEMBERS. Never ADMINISTRATOR.
3. Special status roles (VIP, Subscriber, Booster perks) -- cosmetic or
   access-granting, usually hoisted, few or no extra permissions.
4. Member -- the everyday role, not hoisted, no extra permissions beyond
   the @everyone baseline (or the baseline itself if you gate access).

Keep mentionable false except for roles people legitimately ping (e.g. a
Support role). The bot's own role must sit ABOVE every role it manages.

## @everyone baseline

A sensible public-server baseline:

VIEW_CHANNEL, READ_MESSAGE_HISTORY, SEND_MESSAGES, ADD_REACTIONS,
USE_EXTERNAL_EMOJIS, ATTACH_FILES, EMBED_LINKS, CONNECT, SPEAK,
USE_APPLICATION_COMMANDS, CREATE_PUBLIC_THREADS, SEND_MESSAGES_IN_THREADS

Deliberately absent: MENTION_EVERYONE (mods only), MANAGE_* anything.
For a members-only server, drop VIEW_CHANNEL from the baseline and grant
it via a Member role instead, so unverified accounts see nothing.

## Permission patterns

- Private area: category with private_to: [Role] -- @everyone loses
  VIEW_CHANNEL, listed roles get it. Children inherit automatically.
- Read-only channel: locked: true (@everyone loses SEND_MESSAGES).
- Public window in a private category: child overwrite allowing
  VIEW_CHANNEL for @everyone; the child wins per bit.
- Give Mod-tier roles VIEW_CHANNEL on staff areas via private_to, not by
  raising their guild-wide permissions.

## Guild settings

- verification_level 1 (verified email) minimum for public servers; 2 for
  servers expecting raids.
- explicit_content_filter 2 for public servers.
- rate_limit_per_user (slowmode) 5-10s on busy general channels prevents
  spam without hurting conversation.
- system_channel: point at general/welcome so join messages land visibly.

## Workflow

1. Start from the closest template (get_blueprint_template) and rename to
   fit the community instead of designing from zero.
2. Always run apply_blueprint with dry_run: true first and review the
   plan.
3. Use mode create_only against servers with existing content;
   reconcile only when the blueprint is meant to own the layout.
`;
