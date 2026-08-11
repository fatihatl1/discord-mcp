/**
 * Canned blueprint templates for common community types. Each validates
 * against the blueprint schema (enforced by tests) and follows the design
 * guide: INFORMATION first, locked info channels, staff area last, Admin >
 * Mod > status > Member ladder, sane @everyone baseline.
 */

import type { z } from "zod";
import type { BlueprintObjectSchema } from "./schema.js";

export type BlueprintInput = z.input<typeof BlueprintObjectSchema>;

export interface TemplateInfo {
  kind: string;
  description: string;
}

const EVERYONE_BASELINE = [
  "VIEW_CHANNEL",
  "READ_MESSAGE_HISTORY",
  "SEND_MESSAGES",
  "ADD_REACTIONS",
  "USE_EXTERNAL_EMOJIS",
  "ATTACH_FILES",
  "EMBED_LINKS",
  "CONNECT",
  "SPEAK",
  "USE_APPLICATION_COMMANDS",
  "CREATE_PUBLIC_THREADS",
  "SEND_MESSAGES_IN_THREADS",
];

const MOD_PERMISSIONS = [
  "KICK_MEMBERS",
  "BAN_MEMBERS",
  "MODERATE_MEMBERS",
  "MANAGE_MESSAGES",
  "MANAGE_NICKNAMES",
  "VIEW_AUDIT_LOG",
  "MUTE_MEMBERS",
  "DEAFEN_MEMBERS",
  "MOVE_MEMBERS",
];

const gaming: BlueprintInput = {
  name: "Gaming Community",
  everyone_permissions: EVERYONE_BASELINE,
  verification_level: 1,
  explicit_content_filter: 2,
  roles: [
    { name: "Admin", color: "#e74c3c", hoist: true, permissions: ["ADMINISTRATOR"] },
    { name: "Mod", color: "#3498db", hoist: true, permissions: MOD_PERMISSIONS },
    { name: "VIP", color: "#f1c40f", hoist: true },
    { name: "Member", color: "#95a5a6" },
  ],
  categories: [
    {
      name: "INFORMATION",
      channels: [
        { name: "rules", type: "text", locked: true },
        { name: "announcements", type: "announcement", locked: true },
      ],
    },
    {
      name: "GENERAL",
      channels: [
        { name: "general", type: "text", rate_limit_per_user: 5 },
        { name: "clips-and-highlights", type: "text" },
        { name: "memes", type: "text" },
      ],
    },
    {
      name: "LOOKING FOR GROUP",
      channels: [
        { name: "lfg", type: "text" },
        { name: "Lobby 1", type: "voice" },
        { name: "Lobby 2", type: "voice" },
      ],
    },
    {
      name: "STAFF",
      private_to: ["Admin", "Mod"],
      channels: [
        { name: "staff-chat", type: "text" },
        { name: "mod-log", type: "text" },
        { name: "Staff Voice", type: "voice" },
      ],
    },
  ],
};

const dev: BlueprintInput = {
  name: "Dev Project",
  everyone_permissions: EVERYONE_BASELINE,
  verification_level: 1,
  roles: [
    { name: "Admin", color: "#e74c3c", hoist: true, permissions: ["ADMINISTRATOR"] },
    { name: "Maintainer", color: "#9b59b6", hoist: true, permissions: MOD_PERMISSIONS },
    { name: "Contributor", color: "#2ecc71", hoist: true },
  ],
  categories: [
    {
      name: "INFORMATION",
      channels: [
        { name: "readme", type: "text", locked: true },
        { name: "releases", type: "announcement", locked: true },
      ],
    },
    {
      name: "DEVELOPMENT",
      channels: [
        { name: "general", type: "text" },
        { name: "help", type: "text" },
        { name: "showcase", type: "text" },
        { name: "resources", type: "text" },
      ],
    },
    {
      name: "VOICE",
      channels: [{ name: "Pairing", type: "voice" }],
    },
    {
      name: "STAFF",
      private_to: ["Admin", "Maintainer"],
      channels: [{ name: "maintainers", type: "text" }],
    },
  ],
};

const support: BlueprintInput = {
  name: "Community & Support",
  everyone_permissions: EVERYONE_BASELINE,
  verification_level: 1,
  explicit_content_filter: 2,
  roles: [
    { name: "Admin", color: "#e74c3c", hoist: true, permissions: ["ADMINISTRATOR"] },
    {
      name: "Support",
      color: "#3498db",
      hoist: true,
      mentionable: true,
      permissions: MOD_PERMISSIONS,
    },
    { name: "Member", color: "#95a5a6" },
  ],
  categories: [
    {
      name: "INFORMATION",
      channels: [
        { name: "rules", type: "text", locked: true },
        { name: "announcements", type: "announcement", locked: true },
        { name: "faq", type: "text", locked: true },
      ],
    },
    {
      name: "SUPPORT",
      channels: [
        { name: "get-help", type: "text", rate_limit_per_user: 10 },
        { name: "bug-reports", type: "text", rate_limit_per_user: 10 },
        { name: "feature-requests", type: "text" },
      ],
    },
    {
      name: "COMMUNITY",
      channels: [
        { name: "general", type: "text", rate_limit_per_user: 5 },
        { name: "off-topic", type: "text" },
      ],
    },
    {
      name: "STAFF",
      private_to: ["Admin", "Support"],
      channels: [
        { name: "staff-chat", type: "text" },
        { name: "mod-log", type: "text" },
      ],
    },
  ],
};

const creator: BlueprintInput = {
  name: "Creator Community",
  everyone_permissions: EVERYONE_BASELINE,
  verification_level: 1,
  explicit_content_filter: 2,
  roles: [
    { name: "Admin", color: "#e74c3c", hoist: true, permissions: ["ADMINISTRATOR"] },
    { name: "Mod", color: "#3498db", hoist: true, permissions: MOD_PERMISSIONS },
    { name: "Subscriber", color: "#f1c40f", hoist: true },
    { name: "Member", color: "#95a5a6" },
  ],
  categories: [
    {
      name: "INFORMATION",
      channels: [
        { name: "rules", type: "text", locked: true },
        { name: "announcements", type: "announcement", locked: true },
      ],
    },
    {
      name: "COMMUNITY",
      channels: [
        { name: "general", type: "text", rate_limit_per_user: 5 },
        { name: "fan-art", type: "text" },
        { name: "clips", type: "text" },
      ],
    },
    {
      name: "SUBSCRIBERS",
      private_to: ["Subscriber"],
      channels: [
        { name: "sub-chat", type: "text" },
        { name: "behind-the-scenes", type: "text" },
        { name: "Sub Hangout", type: "voice" },
      ],
    },
    {
      name: "STAFF",
      private_to: ["Admin", "Mod"],
      channels: [
        { name: "staff-chat", type: "text" },
        { name: "mod-log", type: "text" },
      ],
    },
  ],
};

export const TEMPLATES: Readonly<Record<string, BlueprintInput>> =
  Object.freeze({ gaming, dev, support, creator });

export const TEMPLATE_INFO: readonly TemplateInfo[] = Object.freeze([
  {
    kind: "gaming",
    description:
      "Gaming community: LFG + lobbies, clips, VIP role, staff area.",
  },
  {
    kind: "dev",
    description:
      "Software project: releases, help/showcase channels, Maintainer/Contributor ladder.",
  },
  {
    kind: "support",
    description:
      "Product community: FAQ, slowmoded help + bug report channels, pingable Support role.",
  },
  {
    kind: "creator",
    description:
      "Creator/streamer community: fan channels plus a Subscriber-only area.",
  },
]);

export const TEMPLATE_KINDS = TEMPLATE_INFO.map((t) => t.kind) as [
  string,
  ...string[],
];
