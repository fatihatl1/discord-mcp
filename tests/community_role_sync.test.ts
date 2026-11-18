/**
 * Phase 5, Section 49 -- tests for the community role-sync worker.
 *
 * Every case runs against the in-memory FakeApi; nothing here touches the
 * network. The emphasis is on what the worker must NEVER do (write a role
 * outside the Access-* set, act on a bot, write during a dry run, grant
 * access to a cohort role held without Member) rather than only on the happy
 * path, because those are the failures that would actually hurt a live
 * community server.
 */

import { describe, expect, it } from "vitest";

import {
  RoleSyncConfigError,
  RoleSyncSafetyError,
  executeRoleSync,
  planRoleSync,
  resolveRoles,
  runRoleSync,
  type SyncOp,
} from "../src/community/role_sync.js";
import { BADGE_ROLE_NAMES, COHORTS, MEMBER_ROLE_NAME } from "../src/community/roles.js";
import type { APIGuildMember, APIRole } from "../src/discord/types.js";
import { FakeApi } from "./helpers.js";

const GUILD = "100000000000000001";

/** Fixed ids keep assertions readable. */
const ID = {
  everyone: GUILD,
  Member: "400000000000000001",
  BULLHAUS: "400000000000000002",
  RU: "400000000000000003",
  F3NTM: "400000000000000004",
  Trading: "400000000000000005",
  Gaming: "400000000000000006",
  "Access-BULLHAUS": "400000000000000007",
  "Access-RU": "400000000000000008",
  "Access-F3NTM": "400000000000000009",
  Admin: "400000000000000010",
  VIP: "400000000000000011",
} as const;

function role(name: keyof typeof ID, position: number): APIRole {
  return {
    id: ID[name],
    name: name === "everyone" ? "@everyone" : name,
    color: 0,
    hoist: false,
    position,
    permissions: "0",
    managed: false,
    mentionable: false,
  };
}

function fullRoleSet(): APIRole[] {
  return [
    role("everyone", 0),
    role("Member", 1),
    role("Access-F3NTM", 2),
    role("Access-RU", 3),
    role("Access-BULLHAUS", 4),
    role("Gaming", 5),
    role("Trading", 6),
    role("F3NTM", 7),
    role("RU", 8),
    role("BULLHAUS", 9),
    role("VIP", 10),
    role("Admin", 11),
  ];
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

const resolved = () => resolveRoles(fullRoleSet());

function kinds(ops: readonly SyncOp[]): string[] {
  return ops.map((o) => `${o.kind}:${o.username}:${o.roleName}`);
}

describe("resolveRoles", () => {
  it("maps every cohort to its public and internal role", () => {
    const r = resolved();
    expect(r.memberRoleId).toBe(ID.Member);
    expect(r.cohorts.map((c) => c.name)).toEqual(["BULLHAUS", "RU", "F3NTM"]);
    expect([...r.writableRoleIds].sort()).toEqual(
      [ID["Access-BULLHAUS"], ID["Access-RU"], ID["Access-F3NTM"]].sort(),
    );
  });

  it("fails closed, naming every missing role, rather than syncing partially", () => {
    const partial = fullRoleSet().filter(
      (r) => r.name !== "Access-RU" && r.name !== "F3NTM",
    );
    expect(() => resolveRoles(partial)).toThrow(RoleSyncConfigError);
    expect(() => resolveRoles(partial)).toThrow(/Access-RU/);
    expect(() => resolveRoles(partial)).toThrow(/F3NTM/);
  });

  it("fails closed when a role name is duplicated and the mapping is ambiguous", () => {
    const dup = [...fullRoleSet(), { ...role("RU", 20), id: "499999999999999999" }];
    expect(() => resolveRoles(dup)).toThrow(/ambiguous|duplicate/i);
  });

  it("never lists Member or a cohort role as writable", () => {
    const writable = resolved().writableRoleIds;
    for (const id of [ID.Member, ID.BULLHAUS, ID.RU, ID.F3NTM, ID.Trading, ID.Gaming, ID.Admin, ID.VIP]) {
      expect(writable.has(id)).toBe(false);
    }
  });
});

describe("planRoleSync -- granting access", () => {
  it("Member + BULLHAUS grants Access-BULLHAUS", () => {
    const ops = planRoleSync([human("1", "alice", [ID.Member, ID.BULLHAUS])], resolved());
    expect(kinds(ops)).toEqual(["add:alice:Access-BULLHAUS"]);
  });

  it("Member + RU grants Access-RU", () => {
    const ops = planRoleSync([human("2", "boris", [ID.Member, ID.RU])], resolved());
    expect(kinds(ops)).toEqual(["add:boris:Access-RU"]);
  });

  it("Member + F3NTM grants Access-F3NTM", () => {
    const ops = planRoleSync([human("3", "cara", [ID.Member, ID.F3NTM])], resolved());
    expect(kinds(ops)).toEqual(["add:cara:Access-F3NTM"]);
  });

  it("grants every cohort a user legitimately belongs to", () => {
    const ops = planRoleSync(
      [human("4", "dana", [ID.Member, ID.BULLHAUS, ID.RU])],
      resolved(),
    );
    expect(kinds(ops).sort()).toEqual(
      ["add:dana:Access-BULLHAUS", "add:dana:Access-RU"].sort(),
    );
  });
});

describe("planRoleSync -- withholding access", () => {
  it("a cohort role WITHOUT Member grants nothing (the whole point of the model)", () => {
    const ops = planRoleSync(
      [
        human("1", "alice", [ID.BULLHAUS]),
        human("2", "boris", [ID.RU]),
        human("3", "cara", [ID.F3NTM]),
      ],
      resolved(),
    );
    expect(ops).toEqual([]);
  });

  it("Member alone grants no Access-* role", () => {
    expect(planRoleSync([human("1", "alice", [ID.Member])], resolved())).toEqual([]);
  });

  it("removes Access-BULLHAUS once Member is gone but the cohort role remains", () => {
    const ops = planRoleSync(
      [human("1", "alice", [ID.BULLHAUS, ID["Access-BULLHAUS"]])],
      resolved(),
    );
    expect(kinds(ops)).toEqual(["remove:alice:Access-BULLHAUS"]);
    expect(ops[0]?.reason).toContain(MEMBER_ROLE_NAME);
  });

  it("removes Access-RU once the cohort role is gone but Member remains", () => {
    const ops = planRoleSync(
      [human("2", "boris", [ID.Member, ID["Access-RU"]])],
      resolved(),
    );
    expect(kinds(ops)).toEqual(["remove:boris:Access-RU"]);
    expect(ops[0]?.reason).toContain("RU");
  });

  it("removes Access-F3NTM when both prerequisites are gone", () => {
    const ops = planRoleSync([human("3", "cara", [ID["Access-F3NTM"]])], resolved());
    expect(kinds(ops)).toEqual(["remove:cara:Access-F3NTM"]);
  });

  it("never removes the public cohort role itself just because Member is missing", () => {
    const ops = planRoleSync(
      [human("1", "alice", [ID.BULLHAUS, ID["Access-BULLHAUS"]])],
      resolved(),
    );
    expect(ops.every((o) => o.roleId !== ID.BULLHAUS)).toBe(true);
  });
});

describe("planRoleSync -- roles outside the model", () => {
  it("the Trading badge has no access effect", () => {
    expect(planRoleSync([human("1", "alice", [ID.Member, ID.Trading])], resolved())).toEqual([]);
  });

  it("the Gaming badge has no access effect", () => {
    expect(planRoleSync([human("1", "alice", [ID.Member, ID.Gaming])], resolved())).toEqual([]);
  });

  it("badges neither add to nor subtract from a real cohort grant", () => {
    const withBadges = planRoleSync(
      [human("1", "alice", [ID.Member, ID.BULLHAUS, ID.Trading, ID.Gaming])],
      resolved(),
    );
    const without = planRoleSync([human("1", "alice", [ID.Member, ID.BULLHAUS])], resolved());
    expect(kinds(withBadges)).toEqual(kinds(without));
  });

  it("the badge role names are documented as outside the access model", () => {
    expect(BADGE_ROLE_NAMES).toEqual(["Trading", "Gaming"]);
    for (const badge of BADGE_ROLE_NAMES) {
      expect(COHORTS.some((c) => c.cohortRoleName === badge)).toBe(false);
    }
  });

  it("Admin and VIP neither grant nor block Access-*", () => {
    const ops = planRoleSync(
      [human("1", "alice", [ID.Member, ID.Admin, ID.VIP])],
      resolved(),
    );
    expect(ops).toEqual([]);
  });

  it("ignores bot accounts entirely, even perfectly-qualified ones", () => {
    const ops = planRoleSync(
      [
        bot("9", "newsbot", [ID.Member, ID.BULLHAUS]),
        bot("8", "staleaccessbot", [ID["Access-RU"]]),
      ],
      resolved(),
    );
    expect(ops).toEqual([]);
  });

  it("ignores roster entries with no user object", () => {
    const ghost: APIGuildMember = { roles: [ID.Member, ID.RU], joined_at: "" };
    expect(planRoleSync([ghost], resolved())).toEqual([]);
  });
});

describe("planRoleSync -- idempotence", () => {
  it("plans nothing when the roster already matches the model", () => {
    const members = [
      human("1", "alice", [ID.Member, ID.BULLHAUS, ID["Access-BULLHAUS"]]),
      human("2", "boris", [ID.Member, ID.RU, ID["Access-RU"]]),
      human("3", "cara", [ID.Member, ID.F3NTM, ID["Access-F3NTM"]]),
      human("4", "dave", [ID.Member]),
      human("5", "erin", [ID.BULLHAUS]),
    ];
    expect(planRoleSync(members, resolved())).toEqual([]);
  });

  it("is a pure function: planning twice over the same input is identical", () => {
    const members = [human("1", "alice", [ID.Member, ID.BULLHAUS])];
    expect(planRoleSync(members, resolved())).toEqual(planRoleSync(members, resolved()));
  });
});

describe("executeRoleSync -- safety", () => {
  const opFor = (roleId: string, roleName: string): SyncOp => ({
    kind: "add",
    userId: "1",
    username: "alice",
    cohort: "BULLHAUS",
    roleId,
    roleName,
    reason: "test",
  });

  it("performs zero Discord writes in dry-run mode", async () => {
    const api = new FakeApi();
    const ops = planRoleSync([human("1", "alice", [ID.Member, ID.BULLHAUS])], resolved());
    expect(ops).toHaveLength(1);

    const result = await executeRoleSync(api, ops, {
      guildId: GUILD,
      dryRun: true,
      writableRoleIds: resolved().writableRoleIds,
    });

    expect(result.dryRun).toBe(true);
    expect(result.applied).toEqual([]);
    expect(result.planned).toHaveLength(1);
    expect(api.memberRoleWrites).toEqual([]);
    expect(api.writes).toBe(0);
  });

  it("refuses, before any write, to touch a role outside the Access-* set", async () => {
    const api = new FakeApi();
    const writable = resolved().writableRoleIds;

    for (const [id, name] of [
      [ID.Member, "Member"],
      [ID.BULLHAUS, "BULLHAUS"],
      [ID.Trading, "Trading"],
      [ID.Admin, "Admin"],
    ] as const) {
      await expect(
        executeRoleSync(api, [opFor(id, name)], {
          guildId: GUILD,
          dryRun: false,
          writableRoleIds: writable,
        }),
      ).rejects.toThrow(RoleSyncSafetyError);
    }

    expect(api.memberRoleWrites).toEqual([]);
    expect(api.writes).toBe(0);
  });

  it("aborts a whole plan containing a forbidden role without applying the good part", async () => {
    const api = new FakeApi();
    const good: SyncOp = {
      kind: "add",
      userId: "1",
      username: "alice",
      cohort: "BULLHAUS",
      roleId: ID["Access-BULLHAUS"],
      roleName: "Access-BULLHAUS",
      reason: "ok",
    };

    await expect(
      executeRoleSync(api, [good, opFor(ID.Admin, "Admin")], {
        guildId: GUILD,
        dryRun: false,
        writableRoleIds: resolved().writableRoleIds,
      }),
    ).rejects.toThrow(RoleSyncSafetyError);

    expect(api.memberRoleWrites).toEqual([]);
  });

  it("rejects duplicate operations for the same user and role", async () => {
    const api = new FakeApi();
    const op: SyncOp = {
      kind: "add",
      userId: "1",
      username: "alice",
      cohort: "BULLHAUS",
      roleId: ID["Access-BULLHAUS"],
      roleName: "Access-BULLHAUS",
      reason: "ok",
    };

    await expect(
      executeRoleSync(api, [op, op], {
        guildId: GUILD,
        dryRun: false,
        writableRoleIds: resolved().writableRoleIds,
      }),
    ).rejects.toThrow(RoleSyncSafetyError);

    expect(api.memberRoleWrites).toEqual([]);
  });

  it("stops at the first Discord error instead of continuing down the plan", async () => {
    const api = new FakeApi();
    api.members = [
      human("1", "alice", [ID.Member, ID.BULLHAUS]),
      human("2", "boris", [ID.Member, ID.RU]),
      human("3", "cara", [ID.Member, ID.F3NTM]),
    ];
    api.failMemberRoleWriteFor = { userId: "2", roleId: ID["Access-RU"] };

    const ops = planRoleSync(api.members, resolved());
    expect(ops).toHaveLength(3);

    const result = await executeRoleSync(api, ops, {
      guildId: GUILD,
      dryRun: false,
      writableRoleIds: resolved().writableRoleIds,
    });

    expect(result.applied).toHaveLength(1);
    expect(result.failure?.op.userId).toBe("2");
    expect(result.failure?.message).toContain("Missing Permissions");
    // cara's operation was never attempted.
    expect(result.notAttempted.map((o) => o.userId)).toEqual(["2", "3"]);
    expect(api.memberRoleWrites.map((w) => w.userId)).toEqual(["1"]);
  });
});

describe("runRoleSync -- end to end against the fake guild", () => {
  function seededApi(): FakeApi {
    const api = new FakeApi();
    api.roles = fullRoleSet();
    api.members = [
      human("1", "alice", [ID.Member, ID.BULLHAUS]),
      human("2", "boris", [ID.Member, ID.RU]),
      human("3", "cara", [ID.F3NTM]), // no Member: must stay locked out
      human("4", "dave", [ID.Member, ID.Trading, ID.Gaming]), // badges only
      human("5", "erin", [ID.Member, ID["Access-F3NTM"]]), // stale access
      bot("9", "newsbot", [ID.Member, ID.BULLHAUS]),
    ];
    return api;
  }

  it("applies exactly the intended adds and removes, and nothing else", async () => {
    const api = seededApi();
    const result = await runRoleSync(api, GUILD, { dryRun: false });

    expect(result.membersScanned).toBe(6);
    expect(result.humansScanned).toBe(5);
    expect(result.failure).toBeUndefined();

    expect(
      api.memberRoleWrites.map((w) => `${w.kind}:${w.userId}:${w.roleId}`).sort(),
    ).toEqual(
      [
        `add:1:${ID["Access-BULLHAUS"]}`,
        `add:2:${ID["Access-RU"]}`,
        `remove:5:${ID["Access-F3NTM"]}`,
      ].sort(),
    );

    // Nothing outside the Access-* set was ever written.
    const writable = resolved().writableRoleIds;
    expect(api.memberRoleWrites.every((w) => writable.has(w.roleId))).toBe(true);
    // The bot was untouched despite qualifying on paper.
    expect(api.memberRoleWrites.some((w) => w.userId === "9")).toBe(false);
  });

  it("is idempotent: a second run right after the first writes nothing", async () => {
    const api = seededApi();
    await runRoleSync(api, GUILD, { dryRun: false });
    const writesAfterFirst = api.memberRoleWrites.length;

    const second = await runRoleSync(api, GUILD, { dryRun: false });

    expect(second.planned).toEqual([]);
    expect(second.applied).toEqual([]);
    expect(api.memberRoleWrites).toHaveLength(writesAfterFirst);
  });

  it("a dry run against the same guild writes nothing at all", async () => {
    const api = seededApi();
    const result = await runRoleSync(api, GUILD, { dryRun: true });

    expect(result.planned).toHaveLength(3);
    expect(result.applied).toEqual([]);
    expect(api.memberRoleWrites).toEqual([]);
    expect(api.writes).toBe(0);
  });

  it("leaves every member's non-Access roles exactly as they were", async () => {
    const api = seededApi();
    const before = new Map(
      api.members.map((m) => [
        m.user?.id ?? "",
        m.roles.filter((r) => !resolved().writableRoleIds.has(r)).sort(),
      ]),
    );

    await runRoleSync(api, GUILD, { dryRun: false });

    for (const m of api.members) {
      const after = m.roles.filter((r) => !resolved().writableRoleIds.has(r)).sort();
      expect(after).toEqual(before.get(m.user?.id ?? ""));
    }
  });

  it("refuses to run at all when the guild is missing an Access role", async () => {
    const api = seededApi();
    api.roles = api.roles.filter((r) => r.name !== "Access-RU");

    await expect(runRoleSync(api, GUILD, { dryRun: false })).rejects.toThrow(
      RoleSyncConfigError,
    );
    expect(api.memberRoleWrites).toEqual([]);
  });
});
