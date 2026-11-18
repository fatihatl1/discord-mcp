/**
 * Phase 5.1 -- tests for the community membership guard.
 *
 * The guard is READ-ONLY (Section 13: an automatic corrector for this rule
 * is "destructive behavior" and is not deployed). Every case here runs
 * against plain in-memory data; nothing touches the network, and there is
 * no executor to test because there is nothing to write.
 */

import { describe, expect, it } from "vitest";

import {
  MembershipGuardConfigError,
  auditMembership,
  resolveGuardRoles,
} from "../src/community/membership_guard.js";
import { BADGE_ROLE_NAMES, MEMBERSHIP_GATED_ROLE_NAMES } from "../src/community/roles.js";
import type { APIGuildMember, APIRole } from "../src/discord/types.js";

const ID = {
  everyone: "100000000000000001",
  OWNER: "400000000000000001",
  MEMBER: "400000000000000002",
  F3NTM: "400000000000000003",
  BULLHAUS: "400000000000000004",
  DVVV: "400000000000000005",
  INNERCIRCLE: "400000000000000006",
  COACH: "400000000000000007",
  "ADMIN-GLOBAL": "400000000000000008",
  "ADMIN-BULLHAUS": "400000000000000009",
  "ADMIN-RU": "400000000000000010",
  "ADMIN-GAMING": "400000000000000011",
  TRADING: "400000000000000012",
  GAMING: "400000000000000013",
  VIP: "400000000000000014",
} as const;

function role(name: keyof typeof ID, position: number): APIRole {
  return {
    id: ID[name],
    name,
    color: 0,
    hoist: false,
    position,
    permissions: "0",
    managed: false,
    mentionable: false,
  };
}

function fullRoleSet(): APIRole[] {
  return (Object.keys(ID) as Array<keyof typeof ID>).map((name, i) => role(name, i));
}

function human(id: string, username: string, roles: string[]): APIGuildMember {
  return {
    user: { id, username, discriminator: "0", bot: false },
    roles,
    joined_at: new Date(0).toISOString(),
  };
}

function bot(id: string, username: string, roles: string[]): APIGuildMember {
  return {
    user: { id, username, discriminator: "0", bot: true },
    roles,
    joined_at: new Date(0).toISOString(),
  };
}

const resolved = () => resolveGuardRoles(fullRoleSet());

describe("resolveGuardRoles", () => {
  it("resolves MEMBER and every gated role present live", () => {
    const r = resolved();
    expect(r.memberRoleId).toBe(ID.MEMBER);
    expect(r.gatedRoles.size).toBe(MEMBERSHIP_GATED_ROLE_NAMES.length);
    for (const name of MEMBERSHIP_GATED_ROLE_NAMES) {
      expect([...r.gatedRoles.values()]).toContain(name);
    }
  });

  it("fails closed when MEMBER itself does not exist", () => {
    const withoutMember = fullRoleSet().filter((r) => r.name !== "MEMBER");
    expect(() => resolveGuardRoles(withoutMember)).toThrow(MembershipGuardConfigError);
    expect(() => resolveGuardRoles(withoutMember)).toThrow(/MEMBER/);
  });

  it("tolerates a gated role that does not exist yet (skips it, does not throw)", () => {
    const withoutCoach = fullRoleSet().filter((r) => r.name !== "COACH");
    const r = resolveGuardRoles(withoutCoach);
    expect([...r.gatedRoles.values()]).not.toContain("COACH");
    expect(r.memberRoleId).toBe(ID.MEMBER);
  });

  it("OWNER is never part of the gated set", () => {
    expect(MEMBERSHIP_GATED_ROLE_NAMES).not.toContain("OWNER");
    expect([...resolved().gatedRoles.values()]).not.toContain("OWNER");
  });
});

describe("auditMembership -- flags violations", () => {
  it("flags a human holding F3NTM without MEMBER", () => {
    const v = auditMembership([human("1", "alice", [ID.F3NTM])], resolved());
    expect(v).toEqual([{ userId: "1", username: "alice", rolesHeldWithoutMember: ["F3NTM"] }]);
  });

  it("flags every gated role a human holds without MEMBER, not just the first", () => {
    const v = auditMembership([human("1", "alice", [ID.BULLHAUS, ID.DVVV, ID.COACH])], resolved());
    expect(v).toHaveLength(1);
    expect(v[0]?.rolesHeldWithoutMember.sort()).toEqual(["BULLHAUS", "COACH", "DVVV"].sort());
  });

  it("flags a scoped admin role held without MEMBER", () => {
    const v = auditMembership([human("1", "alice", [ID["ADMIN-BULLHAUS"]])], resolved());
    expect(v).toEqual([{ userId: "1", username: "alice", rolesHeldWithoutMember: ["ADMIN-BULLHAUS"] }]);
  });

  it("flags multiple humans independently", () => {
    const v = auditMembership(
      [human("1", "alice", [ID.F3NTM]), human("2", "boris", [ID.DVVV])],
      resolved(),
    );
    expect(v.map((x) => x.username).sort()).toEqual(["alice", "boris"]);
  });
});

describe("auditMembership -- does not flag", () => {
  it("a human holding a gated role ALONGSIDE MEMBER", () => {
    expect(auditMembership([human("1", "alice", [ID.MEMBER, ID.BULLHAUS])], resolved())).toEqual([]);
  });

  it("a human holding MEMBER alone", () => {
    expect(auditMembership([human("1", "alice", [ID.MEMBER])], resolved())).toEqual([]);
  });

  it("a human holding no roles at all", () => {
    expect(auditMembership([human("1", "alice", [])], resolved())).toEqual([]);
  });

  it("OWNER held without MEMBER (Section 7/62 exemption)", () => {
    expect(auditMembership([human("1", "alice", [ID.OWNER])], resolved())).toEqual([]);
  });

  it("every badge role (TRADING, GAMING, VIP) held without MEMBER", () => {
    const v = auditMembership(
      [human("1", "alice", [ID.TRADING, ID.GAMING, ID.VIP])],
      resolved(),
    );
    expect(v).toEqual([]);
  });

  it("badge roles never appear in the gated set at all", () => {
    for (const badge of BADGE_ROLE_NAMES) {
      expect(MEMBERSHIP_GATED_ROLE_NAMES).not.toContain(badge);
    }
  });

  it("bot accounts, even ones that would otherwise violate", () => {
    const v = auditMembership([bot("9", "newsbot", [ID["ADMIN-GLOBAL"]])], resolved());
    expect(v).toEqual([]);
  });

  it("a roster entry with no user object", () => {
    const ghost: APIGuildMember = { roles: [ID.BULLHAUS], joined_at: "" };
    expect(auditMembership([ghost], resolved())).toEqual([]);
  });
});

describe("auditMembership -- purity and idempotence", () => {
  it("is a pure function: identical input produces identical output", () => {
    const members = [human("1", "alice", [ID.F3NTM]), human("2", "boris", [ID.MEMBER, ID.DVVV])];
    expect(auditMembership(members, resolved())).toEqual(auditMembership(members, resolved()));
  });

  it("never mutates the input member list", () => {
    const members = [human("1", "alice", [ID.F3NTM])];
    const before = JSON.stringify(members);
    auditMembership(members, resolved());
    expect(JSON.stringify(members)).toBe(before);
  });
});
