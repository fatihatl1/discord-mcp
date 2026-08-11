import { describe, expect, it } from "vitest";
import { applyPlan, buildGuildCreatePayload } from "../src/blueprint/apply.js";
import { buildPlan } from "../src/blueprint/plan.js";
import { validateBlueprint } from "../src/blueprint/schema.js";
import { PERMISSIONS } from "../src/discord/permissions.js";
import { EXAMPLE_BLUEPRINT, FakeApi } from "./helpers.js";

describe("apply + idempotency", () => {
  it("applies a full blueprint, then a second apply is a zero-operation no-op", async () => {
    const api = new FakeApi();
    const bp = validateBlueprint(EXAMPLE_BLUEPRINT);

    // First apply against an empty guild.
    const live1 = api.snapshot();
    const plan1 = buildPlan(bp, live1, "reconcile");
    expect(plan1.operations.length).toBeGreaterThan(0);
    const result1 = await applyPlan(api, api.guildId, plan1, live1);
    expect(result1.completed).toBe(true);
    expect(result1.results.every((r) => r.status === "applied")).toBe(true);
    const writesAfterFirst = api.writes;
    expect(writesAfterFirst).toBeGreaterThan(0);

    // The guild now matches the blueprint.
    const live2 = api.snapshot();
    const plan2 = buildPlan(bp, live2, "reconcile");
    expect(plan2.operations).toEqual([]);
    expect(plan2.orphans.roles).toEqual([]);
    expect(plan2.orphans.channels).toEqual([]);

    // Applying the empty plan performs zero write calls.
    const result2 = await applyPlan(api, api.guildId, plan2, live2);
    expect(result2.completed).toBe(true);
    expect(api.writes).toBe(writesAfterFirst);
  });

  it("provisioned state matches blueprint semantics", async () => {
    const api = new FakeApi();
    const bp = validateBlueprint(EXAMPLE_BLUEPRINT);
    const live = api.snapshot();
    const plan = buildPlan(bp, live, "reconcile");
    await applyPlan(api, api.guildId, plan, live);

    // @everyone baseline was updated.
    const everyone = api.roles.find((r) => r.id === api.guildId);
    expect(everyone?.permissions).toBe(
      (PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.READ_MESSAGE_HISTORY).toString(),
    );

    // Role order: Admin above Member.
    const admin = api.roles.find((r) => r.name === "Admin");
    const member = api.roles.find((r) => r.name === "Member");
    expect(admin).toBeDefined();
    expect(member).toBeDefined();
    expect((admin?.position ?? 0) > (member?.position ?? 0)).toBe(true);

    // staff-chat lives under STAFF and carries the private pattern.
    const staffCat = api.channels.find((c) => c.name === "STAFF" && c.type === 4);
    const staffChat = api.channels.find((c) => c.name === "staff-chat");
    expect(staffChat?.parent_id).toBe(staffCat?.id);
    const overwrites = staffChat?.permission_overwrites ?? [];
    const everyoneOw = overwrites.find((ow) => ow.id === api.guildId);
    const adminOw = overwrites.find((ow) => ow.id === admin?.id);
    expect(everyoneOw?.deny).toBe(PERMISSIONS.VIEW_CHANNEL.toString());
    expect(adminOw?.allow).toBe(PERMISSIONS.VIEW_CHANNEL.toString());
  });

  it("reconciles drift: role overwrite removed by hand is restored, stray one removed", async () => {
    const api = new FakeApi();
    const bp = validateBlueprint(EXAMPLE_BLUEPRINT);
    const live1 = api.snapshot();
    await applyPlan(api, api.guildId, buildPlan(bp, live1, "reconcile"), live1);

    // Drift: someone removes the Admin overwrite from staff-chat and adds a
    // stray Member overwrite.
    const staffChat = api.channels.find((c) => c.name === "staff-chat");
    const admin = api.roles.find((r) => r.name === "Admin");
    const member = api.roles.find((r) => r.name === "Member");
    if (!staffChat || !admin || !member) throw new Error("setup failed");
    staffChat.permission_overwrites = (
      staffChat.permission_overwrites ?? []
    ).filter((ow) => ow.id !== admin.id);
    staffChat.permission_overwrites.push({
      id: member.id,
      type: 0,
      allow: PERMISSIONS.VIEW_CHANNEL.toString(),
      deny: "0",
    });

    const live2 = api.snapshot();
    const plan2 = buildPlan(bp, live2, "reconcile");
    const owOp = plan2.operations.find(
      (op) => op.kind === "set_channel_overwrites",
    );
    expect(owOp).toBeDefined();
    if (owOp?.kind !== "set_channel_overwrites") throw new Error("unreachable");
    expect(owOp.channel).toBe("staff-chat");
    expect(owOp.removes).toEqual(["Member"]);

    await applyPlan(api, api.guildId, plan2, live2);
    const after = api.channels.find((c) => c.name === "staff-chat");
    const ids = (after?.permission_overwrites ?? []).map((ow) => ow.id).sort();
    expect(ids).toEqual([api.guildId, admin.id].sort());

    // And a third pass is a no-op again.
    const live3 = api.snapshot();
    expect(buildPlan(bp, live3, "reconcile").operations).toEqual([]);
  });

  it("stops on the first failure and reports partial progress", async () => {
    const api = new FakeApi();
    const failing = Object.create(api) as FakeApi & {
      createChannel: FakeApi["createChannel"];
    };
    let channelCalls = 0;
    failing.createChannel = async (guildId, payload, reason) => {
      channelCalls++;
      if (channelCalls > 2) {
        throw new Error("boom: simulated API failure");
      }
      return api.createChannel(guildId, payload, reason);
    };

    const bp = validateBlueprint(EXAMPLE_BLUEPRINT);
    const live = api.snapshot();
    const plan = buildPlan(bp, live, "reconcile");
    const result = await applyPlan(failing, api.guildId, plan, live);
    expect(result.completed).toBe(false);
    expect(result.error).toContain("boom");
    const statuses = result.results.map((r) => r.status);
    expect(statuses.filter((s) => s === "failed")).toHaveLength(1);
    expect(statuses[statuses.length - 1]).toBe("failed");
  });
});

describe("guild create payload", () => {
  it("builds the single-request POST /guilds payload with placeholder ids", () => {
    const bp = validateBlueprint({
      ...EXAMPLE_BLUEPRINT,
      system_channel: "announcements",
    });
    const payload = buildGuildCreatePayload(bp);

    // roles[0] is @everyone with the baseline permissions.
    expect(payload.roles?.[0]).toMatchObject({
      id: 0,
      name: "@everyone",
      permissions: (
        PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.READ_MESSAGE_HISTORY
      ).toString(),
    });
    expect(payload.roles?.[1]?.name).toBe("Admin");
    expect(payload.roles?.[2]?.name).toBe("Member");

    const channels = payload.channels ?? [];
    // Categories come before any channel that references them.
    const categoryIndexes = channels
      .map((c, i) => (c.type === 4 ? i : -1))
      .filter((i) => i >= 0);
    const childIndexes = channels
      .map((c, i) => (c.parent_id !== undefined ? i : -1))
      .filter((i) => i >= 0);
    expect(Math.max(...categoryIndexes)).toBeLessThan(
      Math.min(...childIndexes),
    );

    // Children reference their category's placeholder id.
    const staffCategory = channels.find((c) => c.name === "STAFF");
    const staffChat = channels.find((c) => c.name === "staff-chat");
    expect(staffChat?.parent_id).toBe(staffCategory?.id);

    // Overwrites reference placeholder role ids (@everyone = 0, Admin = 1).
    expect(staffChat?.permission_overwrites).toEqual([
      {
        id: 0,
        type: 0,
        allow: "0",
        deny: PERMISSIONS.VIEW_CHANNEL.toString(),
      },
      {
        id: 1,
        type: 0,
        allow: PERMISSIONS.VIEW_CHANNEL.toString(),
        deny: "0",
      },
    ]);

    // system_channel resolves to the announcements placeholder.
    const announcements = channels.find((c) => c.name === "announcements");
    expect(payload.system_channel_id).toBe(announcements?.id);
  });
});
