import { describe, expect, it } from "vitest";
import {
  computeEffectivePermissions,
} from "../src/discord/effective_permissions.js";
import { namesToBitfield } from "../src/discord/permissions.js";
import type { APIRole } from "../src/discord/types.js";

const GUILD_ID = "100000000000000001";

function role(
  id: string,
  name: string,
  position: number,
  permissionNames: readonly string[] = [],
): APIRole {
  return {
    id,
    name,
    color: 0,
    hoist: false,
    position,
    permissions: namesToBitfield(permissionNames),
    managed: false,
    mentionable: false,
  };
}

const everyone = role(GUILD_ID, "@everyone", 0, ["VIEW_CHANNEL"]);
const memberRole = role("200000000000000001", "Member", 1, ["SEND_MESSAGES"]);
const vipRole = role("200000000000000002", "VIP", 2, []);
const innerCircleRole = role("200000000000000003", "Inner Circle", 3, []);
const adminRole = role("200000000000000004", "Admin", 4, ["ADMINISTRATOR"]);

const ALL_ROLES = [everyone, memberRole, vipRole, innerCircleRole, adminRole];

describe("computeEffectivePermissions: server level", () => {
  it("starts from @everyone when the member holds no roles", () => {
    const result = computeEffectivePermissions({
      roles: ALL_ROLES,
      everyoneRoleId: GUILD_ID,
      roleIds: [],
    });
    expect(result.server_permissions).toEqual(["VIEW_CHANNEL"]);
    expect(result.administrator).toBe(false);
  });

  it("ORs in every held role's permissions (role allow)", () => {
    const result = computeEffectivePermissions({
      roles: ALL_ROLES,
      everyoneRoleId: GUILD_ID,
      roleIds: [memberRole.id],
    });
    expect(result.server_permissions.sort()).toEqual(
      ["VIEW_CHANNEL", "SEND_MESSAGES"].sort(),
    );
    expect(result.contributing_roles.map((r) => r.name)).toEqual(["Member"]);
  });

  it("ADMINISTRATOR on any held role grants every permission", () => {
    const result = computeEffectivePermissions({
      roles: ALL_ROLES,
      everyoneRoleId: GUILD_ID,
      roleIds: [memberRole.id, adminRole.id],
    });
    expect(result.administrator).toBe(true);
    // ALL_PERMISSIONS_BITS decodes to the full documented permission list.
    expect(result.server_permissions).toContain("MANAGE_GUILD");
    expect(result.server_permissions).toContain("KICK_MEMBERS");
  });
});

describe("computeEffectivePermissions: channel overwrites", () => {
  const channelId = "300000000000000001";

  it("@everyone deny overwrite removes a base permission at channel level", () => {
    const result = computeEffectivePermissions({
      roles: ALL_ROLES,
      everyoneRoleId: GUILD_ID,
      roleIds: [],
      channel: {
        id: channelId,
        permission_overwrites: [
          { id: GUILD_ID, type: 0, allow: "0", deny: namesToBitfield(["VIEW_CHANNEL"]) },
        ],
      },
    });
    expect(result.channel_permissions).toEqual([]);
  });

  it("@everyone allow overwrite adds a permission not present in the base", () => {
    const result = computeEffectivePermissions({
      roles: ALL_ROLES,
      everyoneRoleId: GUILD_ID,
      roleIds: [],
      channel: {
        id: channelId,
        permission_overwrites: [
          {
            id: GUILD_ID,
            type: 0,
            allow: namesToBitfield(["ADD_REACTIONS"]),
            deny: "0",
          },
        ],
      },
    });
    expect(result.channel_permissions?.sort()).toEqual(
      ["VIEW_CHANNEL", "ADD_REACTIONS"].sort(),
    );
  });

  it("a single role's deny overwrite removes a permission at channel level", () => {
    const result = computeEffectivePermissions({
      roles: ALL_ROLES,
      everyoneRoleId: GUILD_ID,
      roleIds: [memberRole.id],
      channel: {
        id: channelId,
        permission_overwrites: [
          {
            id: memberRole.id,
            type: 0,
            allow: "0",
            deny: namesToBitfield(["SEND_MESSAGES"]),
          },
        ],
      },
    });
    expect(result.channel_permissions).not.toContain("SEND_MESSAGES");
  });

  it("a single role's allow overwrite adds a permission at channel level", () => {
    const result = computeEffectivePermissions({
      roles: ALL_ROLES,
      everyoneRoleId: GUILD_ID,
      roleIds: [vipRole.id],
      channel: {
        id: channelId,
        permission_overwrites: [
          {
            id: vipRole.id,
            type: 0,
            allow: namesToBitfield(["EMBED_LINKS"]),
            deny: "0",
          },
        ],
      },
    });
    expect(result.channel_permissions).toContain("EMBED_LINKS");
  });

  it("Member/VIP/Inner Circle: when held roles conflict, allow from any role wins over deny from another", () => {
    // Classic Discord precedence case: Member is denied SEND_MESSAGES on this
    // channel, but Inner Circle is allowed it. A member holding both ends up
    // allowed, because all applicable denies are combined and removed first,
    // then all applicable allows are combined and added back.
    const result = computeEffectivePermissions({
      roles: ALL_ROLES,
      everyoneRoleId: GUILD_ID,
      roleIds: [memberRole.id, innerCircleRole.id],
      channel: {
        id: channelId,
        permission_overwrites: [
          {
            id: memberRole.id,
            type: 0,
            allow: "0",
            deny: namesToBitfield(["SEND_MESSAGES"]),
          },
          {
            id: innerCircleRole.id,
            type: 0,
            allow: namesToBitfield(["SEND_MESSAGES"]),
            deny: "0",
          },
        ],
      },
    });
    expect(result.channel_permissions).toContain("SEND_MESSAGES");
  });

  it("category overwrites apply first, channel overwrites apply on top", () => {
    const categoryId = "350000000000000001";
    const result = computeEffectivePermissions({
      roles: ALL_ROLES,
      everyoneRoleId: GUILD_ID,
      roleIds: [],
      category: {
        id: categoryId,
        permission_overwrites: [
          { id: GUILD_ID, type: 0, allow: "0", deny: namesToBitfield(["VIEW_CHANNEL"]) },
        ],
      },
      channel: {
        id: channelId,
        permission_overwrites: [
          {
            id: GUILD_ID,
            type: 0,
            allow: namesToBitfield(["VIEW_CHANNEL"]),
            deny: "0",
          },
        ],
      },
    });
    // Category denies VIEW_CHANNEL; the channel's own overwrite re-allows it.
    expect(result.channel_permissions).toContain("VIEW_CHANNEL");
  });

  it("a category-only deny (no channel overwrite for that target) still applies", () => {
    const categoryId = "350000000000000002";
    const result = computeEffectivePermissions({
      roles: ALL_ROLES,
      everyoneRoleId: GUILD_ID,
      roleIds: [],
      category: {
        id: categoryId,
        permission_overwrites: [
          { id: GUILD_ID, type: 0, allow: "0", deny: namesToBitfield(["VIEW_CHANNEL"]) },
        ],
      },
      channel: { id: channelId, permission_overwrites: [] },
    });
    expect(result.channel_permissions).toEqual([]);
  });

  it("ADMINISTRATOR bypasses category and channel overwrites entirely", () => {
    const categoryId = "350000000000000003";
    const result = computeEffectivePermissions({
      roles: ALL_ROLES,
      everyoneRoleId: GUILD_ID,
      roleIds: [adminRole.id],
      category: {
        id: categoryId,
        permission_overwrites: [
          { id: GUILD_ID, type: 0, allow: "0", deny: namesToBitfield(["VIEW_CHANNEL"]) },
        ],
      },
      channel: {
        id: channelId,
        permission_overwrites: [
          { id: GUILD_ID, type: 0, allow: "0", deny: namesToBitfield(["SEND_MESSAGES"]) },
        ],
      },
    });
    expect(result.channel_permissions).toContain("VIEW_CHANNEL");
    expect(result.channel_permissions).toContain("SEND_MESSAGES");
  });

  it("a member-specific overwrite overrules the role-based result", () => {
    const memberId = "400000000000000001";
    const result = computeEffectivePermissions({
      roles: ALL_ROLES,
      everyoneRoleId: GUILD_ID,
      roleIds: [memberRole.id],
      memberId,
      channel: {
        id: channelId,
        permission_overwrites: [
          {
            id: memberRole.id,
            type: 0,
            allow: "0",
            deny: namesToBitfield(["SEND_MESSAGES"]),
          },
          {
            id: memberId,
            type: 1,
            allow: namesToBitfield(["SEND_MESSAGES"]),
            deny: "0",
          },
        ],
      },
    });
    expect(result.channel_permissions).toContain("SEND_MESSAGES");
  });

  it("role-set mode (no memberId) ignores member-specific overwrites", () => {
    const memberId = "400000000000000002";
    const result = computeEffectivePermissions({
      roles: ALL_ROLES,
      everyoneRoleId: GUILD_ID,
      roleIds: [memberRole.id],
      // memberId intentionally omitted: hypothetical role-set evaluation.
      channel: {
        id: channelId,
        permission_overwrites: [
          {
            id: memberRole.id,
            type: 0,
            allow: "0",
            deny: namesToBitfield(["SEND_MESSAGES"]),
          },
          {
            id: memberId,
            type: 1,
            allow: namesToBitfield(["SEND_MESSAGES"]),
            deny: "0",
          },
        ],
      },
    });
    expect(result.channel_permissions).not.toContain("SEND_MESSAGES");
  });
});
