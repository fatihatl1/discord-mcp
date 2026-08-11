import { describe, expect, it } from "vitest";
import { buildPlan, type LiveState } from "../src/blueprint/plan.js";
import { validateBlueprint } from "../src/blueprint/schema.js";
import type { APIRole } from "../src/discord/types.js";
import { EXAMPLE_BLUEPRINT } from "./helpers.js";

const GUILD_ID = "100000000000000001";

function emptyLive(): LiveState {
  const everyone: APIRole = {
    id: GUILD_ID,
    name: "@everyone",
    color: 0,
    hoist: false,
    position: 0,
    permissions: "0",
    managed: false,
    mentionable: false,
  };
  return { guildId: GUILD_ID, roles: [everyone], channels: [] };
}

describe("planner", () => {
  it("orders operations: everyone -> roles -> positions -> categories -> channels", () => {
    const bp = validateBlueprint(EXAMPLE_BLUEPRINT);
    const plan = buildPlan(bp, emptyLive(), "reconcile");

    const kinds = plan.operations.map((op) => op.kind);
    expect(kinds).toEqual([
      "update_everyone_permissions",
      "create_role", // Admin
      "create_role", // Member
      "set_role_positions",
      "create_category", // INFORMATION
      "create_category", // STAFF
      "create_channel", // announcements
      "create_channel", // rules
      "create_channel", // staff-chat
    ]);

    // Categories are planned before every channel that references them.
    const firstChannel = kinds.indexOf("create_channel");
    const lastCategory = kinds.lastIndexOf("create_category");
    expect(lastCategory).toBeLessThan(firstChannel);
  });

  it("expresses the private-channel pattern in created channel overwrites", () => {
    const bp = validateBlueprint(EXAMPLE_BLUEPRINT);
    const plan = buildPlan(bp, emptyLive(), "reconcile");
    const staffChat = plan.operations.find(
      (op) => op.kind === "create_channel" && op.channel === "staff-chat",
    );
    expect(staffChat).toBeDefined();
    if (staffChat?.kind !== "create_channel") throw new Error("unreachable");
    expect(staffChat.parent).toBe("STAFF");
    expect(staffChat.overwrites).toEqual([
      { role: "@everyone", allow: [], deny: ["VIEW_CHANNEL"] },
      { role: "Admin", allow: ["VIEW_CHANNEL"], deny: [] },
    ]);
  });

  it("never plans a delete and reports unmatched live entities as orphans", () => {
    const bp = validateBlueprint(EXAMPLE_BLUEPRINT);
    const live = emptyLive();
    live.roles.push({
      id: "400000000000000001",
      name: "Legacy Role",
      color: 0,
      hoist: false,
      position: 5,
      permissions: "0",
      managed: false,
      mentionable: false,
    });
    live.channels.push({
      id: "500000000000000001",
      type: 0,
      name: "old-general",
      position: 0,
      parent_id: null,
      permission_overwrites: [],
    });

    const plan = buildPlan(bp, live, "reconcile");
    for (const op of plan.operations) {
      expect(op.kind).not.toMatch(/delete/);
    }
    expect(plan.orphans.roles).toEqual([
      { id: "400000000000000001", name: "Legacy Role" },
    ]);
    expect(plan.orphans.channels).toEqual([
      { id: "500000000000000001", name: "old-general", type: "text" },
    ]);
  });

  it("reconcile updates a differing role; create_only skips it", () => {
    const bp = validateBlueprint({
      name: "Srv",
      roles: [{ name: "Admin", color: "#ff0000" }],
    });
    const live = emptyLive();
    live.roles.push({
      id: "400000000000000002",
      name: "Admin",
      color: 0x00ff00,
      hoist: false,
      position: 1,
      permissions: "8",
      managed: false,
      mentionable: false,
    });

    const reconcile = buildPlan(bp, live, "reconcile");
    const update = reconcile.operations.find((op) => op.kind === "update_role");
    expect(update).toBeDefined();
    if (update?.kind !== "update_role") throw new Error("unreachable");
    expect(update.changes["color"]).toEqual({ from: "#00ff00", to: "#ff0000" });
    // permissions were not stated in the blueprint -> not managed, no change.
    expect(update.changes["permissions"]).toBeUndefined();

    const createOnly = buildPlan(bp, live, "create_only");
    expect(createOnly.operations).toEqual([]);
    expect(createOnly.skipped.some((s) => s.name === "Admin")).toBe(true);
  });

  it("ignores managed (integration) roles when matching", () => {
    const bp = validateBlueprint({ name: "Srv", roles: [{ name: "Bot" }] });
    const live = emptyLive();
    live.roles.push({
      id: "400000000000000003",
      name: "Bot",
      color: 0,
      hoist: false,
      position: 9,
      permissions: "8",
      managed: true,
      mentionable: false,
    });
    const plan = buildPlan(bp, live, "reconcile");
    // The managed role cannot be matched or updated; a new role is created.
    expect(plan.operations.map((o) => o.kind)).toContain("create_role");
    expect(plan.orphans.roles).toEqual([]);
  });

  it("flags a type conflict instead of acting", () => {
    const bp = validateBlueprint({
      name: "Srv",
      channels: [{ name: "general", type: "voice" }],
    });
    const live = emptyLive();
    live.channels.push({
      id: "500000000000000002",
      type: 0,
      name: "general",
      position: 0,
      parent_id: null,
      permission_overwrites: [],
    });
    const plan = buildPlan(bp, live, "reconcile");
    const conflict = plan.operations.find((op) => op.kind === "conflict");
    expect(conflict).toBeDefined();
    if (conflict?.kind !== "conflict") throw new Error("unreachable");
    expect(conflict.message).toContain("cannot convert");
    expect(plan.summary.conflicts).toBe(1);
  });
});
