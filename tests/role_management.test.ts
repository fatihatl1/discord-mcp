import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { namesToBitfield } from "../src/discord/permissions.js";
import { buildServer } from "../src/server.js";
import { buildHierarchyFixture, type HierarchyFixture } from "./helpers_hierarchy.js";

async function setup(fixture: HierarchyFixture): Promise<Client> {
  const server = buildServer({ api: fixture.api, dryRun: false });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
  return mcp;
}

function resultText(res: unknown): string {
  const content = (res as { content: Array<{ type: string; text: string }> }).content;
  return content[0]?.text ?? "";
}

function body(res: unknown): any {
  return JSON.parse(resultText(res));
}

function isError(res: unknown): boolean {
  return Boolean((res as { isError?: boolean }).isError);
}

describe("get_role", () => {
  it("returns a role by id", async () => {
    const fixture = buildHierarchyFixture(["KICK_MEMBERS"]);
    const mcp = await setup(fixture);
    const res = await mcp.callTool({
      name: "get_role",
      arguments: { guild_id: fixture.guildId, role_id: fixture.roleIds.mod },
    });
    expect(isError(res)).toBe(false);
    const b = body(res);
    expect(b.role.id).toBe(fixture.roleIds.mod);
    expect(b.role.name).toBe("Mod");
    expect(b.role.permissions).toEqual(["KICK_MEMBERS"]);
    expect(b.role.managed).toBe(false);
  });

  it("returns ROLE_NOT_FOUND for an unknown role", async () => {
    const fixture = buildHierarchyFixture();
    const mcp = await setup(fixture);
    const res = await mcp.callTool({
      name: "get_role",
      arguments: { guild_id: fixture.guildId, role_id: "999999999999999999" },
    });
    expect(isError(res)).toBe(true);
    expect(body(res).error.type).toBe("ROLE_NOT_FOUND");
  });
});

describe("edit_role_permissions", () => {
  it("dry run (default) performs zero writes", async () => {
    const fixture = buildHierarchyFixture(["KICK_MEMBERS"]);
    const mcp = await setup(fixture);
    const before = fixture.api.writes;
    const res = await mcp.callTool({
      name: "edit_role_permissions",
      arguments: {
        guild_id: fixture.guildId,
        role_id: fixture.roleIds.mod,
        add_permissions: ["BAN_MEMBERS"],
      },
    });
    const b = body(res);
    expect(b.dry_run).toBe(true);
    expect(b.permissions_added).toEqual(["BAN_MEMBERS"]);
    expect(fixture.api.writes).toBe(before);
    const modRole = fixture.api.roles.find((r) => r.id === fixture.roleIds.mod)!;
    expect(modRole.permissions).toBe(namesToBitfield(["KICK_MEMBERS"]));
  });

  it("adds a permission (incremental, dry_run=false)", async () => {
    const fixture = buildHierarchyFixture(["KICK_MEMBERS"]);
    const mcp = await setup(fixture);
    const res = await mcp.callTool({
      name: "edit_role_permissions",
      arguments: {
        guild_id: fixture.guildId,
        role_id: fixture.roleIds.mod,
        add_permissions: ["BAN_MEMBERS"],
        dry_run: false,
      },
    });
    const b = body(res);
    expect(b.dry_run).toBe(false);
    expect(b.role.permissions.sort()).toEqual(["BAN_MEMBERS", "KICK_MEMBERS"].sort());
    expect(fixture.api.writes).toBe(1);
  });

  it("removes a permission (incremental, dry_run=false)", async () => {
    const fixture = buildHierarchyFixture(["KICK_MEMBERS", "BAN_MEMBERS"]);
    const mcp = await setup(fixture);
    const res = await mcp.callTool({
      name: "edit_role_permissions",
      arguments: {
        guild_id: fixture.guildId,
        role_id: fixture.roleIds.mod,
        remove_permissions: ["BAN_MEMBERS"],
        dry_run: false,
      },
    });
    const b = body(res);
    expect(b.role.permissions).toEqual(["KICK_MEMBERS"]);
  });

  it("exact replacement overwrites the whole set", async () => {
    const fixture = buildHierarchyFixture(["KICK_MEMBERS", "BAN_MEMBERS"]);
    const mcp = await setup(fixture);
    const res = await mcp.callTool({
      name: "edit_role_permissions",
      arguments: {
        guild_id: fixture.guildId,
        role_id: fixture.roleIds.mod,
        permissions: ["VIEW_CHANNEL"],
        dry_run: false,
      },
    });
    const b = body(res);
    expect(b.role.permissions).toEqual(["VIEW_CHANNEL"]);
  });

  it("rejects mixing exact and incremental styles", async () => {
    const fixture = buildHierarchyFixture();
    const mcp = await setup(fixture);
    const res = await mcp.callTool({
      name: "edit_role_permissions",
      arguments: {
        guild_id: fixture.guildId,
        role_id: fixture.roleIds.mod,
        permissions: ["VIEW_CHANNEL"],
        add_permissions: ["BAN_MEMBERS"],
      },
    });
    expect(isError(res)).toBe(true);
  });

  it("blocks adding ADMINISTRATOR by default", async () => {
    const fixture = buildHierarchyFixture(["KICK_MEMBERS"]);
    const mcp = await setup(fixture);
    const before = fixture.api.writes;
    const res = await mcp.callTool({
      name: "edit_role_permissions",
      arguments: {
        guild_id: fixture.guildId,
        role_id: fixture.roleIds.mod,
        add_permissions: ["ADMINISTRATOR"],
        dry_run: false,
      },
    });
    expect(isError(res)).toBe(true);
    expect(body(res).error.type).toBe("ADMINISTRATOR_OPT_IN_REQUIRED");
    expect(fixture.api.writes).toBe(before);
  });

  it("allows adding ADMINISTRATOR with explicit opt-in", async () => {
    const fixture = buildHierarchyFixture(["KICK_MEMBERS"]);
    const mcp = await setup(fixture);
    const res = await mcp.callTool({
      name: "edit_role_permissions",
      arguments: {
        guild_id: fixture.guildId,
        role_id: fixture.roleIds.mod,
        add_permissions: ["ADMINISTRATOR"],
        allow_administrator: true,
        dry_run: false,
      },
    });
    expect(isError(res)).toBe(false);
    const b = body(res);
    expect(b.administrator_after).toBe(true);
    expect(b.role.permissions).toContain("ADMINISTRATOR");
  });

  it("allows removing ADMINISTRATOR without any opt-in", async () => {
    const fixture = buildHierarchyFixture(["ADMINISTRATOR", "KICK_MEMBERS"]);
    const mcp = await setup(fixture);
    const res = await mcp.callTool({
      name: "edit_role_permissions",
      arguments: {
        guild_id: fixture.guildId,
        role_id: fixture.roleIds.mod,
        remove_permissions: ["ADMINISTRATOR"],
        dry_run: false,
      },
    });
    expect(isError(res)).toBe(false);
    const b = body(res);
    expect(b.administrator_after).toBe(false);
    expect(b.role.permissions).not.toContain("ADMINISTRATOR");
  });

  it("blocks a role above the bot's highest role (ROLE_HIERARCHY_BLOCKED)", async () => {
    const fixture = buildHierarchyFixture();
    const mcp = await setup(fixture);
    const before = fixture.api.writes;
    const res = await mcp.callTool({
      name: "edit_role_permissions",
      arguments: {
        guild_id: fixture.guildId,
        role_id: fixture.roleIds.owner,
        add_permissions: ["BAN_MEMBERS"],
        dry_run: false,
      },
    });
    expect(isError(res)).toBe(true);
    expect(body(res).error.type).toBe("ROLE_HIERARCHY_BLOCKED");
    expect(fixture.api.writes).toBe(before);
    expect(fixture.api.roles.find((r) => r.id === fixture.roleIds.owner)!.permissions).toBe(
      namesToBitfield(["ADMINISTRATOR"]),
    );
  });

  it("blocks the bot's own managed role (SELF_ROLE_EDIT_BLOCKED)", async () => {
    const fixture = buildHierarchyFixture();
    const mcp = await setup(fixture);
    const before = fixture.api.writes;
    const res = await mcp.callTool({
      name: "edit_role_permissions",
      arguments: {
        guild_id: fixture.guildId,
        role_id: fixture.roleIds.bullhausAi,
        add_permissions: ["BAN_MEMBERS"],
        dry_run: false,
      },
    });
    expect(isError(res)).toBe(true);
    expect(body(res).error.type).toBe("SELF_ROLE_EDIT_BLOCKED");
    expect(fixture.api.writes).toBe(before);
  });

  it("surfaces Discord's rejection of a managed (non-self) role as DISCORD_REJECTED_MANAGED_ROLE_EDIT", async () => {
    const fixture = buildHierarchyFixture();
    const mcp = await setup(fixture);
    const before = fixture.api.writes;
    const rolesBefore = fixture.api.roles.length;
    const res = await mcp.callTool({
      name: "edit_role_permissions",
      arguments: {
        guild_id: fixture.guildId,
        role_id: fixture.roleIds.booster,
        add_permissions: ["BAN_MEMBERS"],
        dry_run: false,
      },
    });
    expect(isError(res)).toBe(true);
    const b = body(res);
    expect(b.error.type).toBe("DISCORD_REJECTED_MANAGED_ROLE_EDIT");
    expect(b.error.discord_status).toBe(403);
    // No duplicate role created, no write recorded, no create_role fallback.
    expect(fixture.api.writes).toBe(before);
    expect(fixture.api.roles.length).toBe(rolesBefore);
  });

  it("never falls back to create_role (write count stays exactly 1 on success)", async () => {
    const fixture = buildHierarchyFixture(["KICK_MEMBERS"]);
    const mcp = await setup(fixture);
    const rolesBefore = fixture.api.roles.length;
    await mcp.callTool({
      name: "edit_role_permissions",
      arguments: {
        guild_id: fixture.guildId,
        role_id: fixture.roleIds.mod,
        add_permissions: ["BAN_MEMBERS"],
        dry_run: false,
      },
    });
    expect(fixture.api.writes).toBe(1);
    expect(fixture.api.roles.length).toBe(rolesBefore);
  });
});

describe("edit_role", () => {
  it("updates a safe property (dry_run=false)", async () => {
    const fixture = buildHierarchyFixture();
    const mcp = await setup(fixture);
    const res = await mcp.callTool({
      name: "edit_role",
      arguments: {
        guild_id: fixture.guildId,
        role_id: fixture.roleIds.mod,
        name: "Moderator",
        hoist: true,
        dry_run: false,
      },
    });
    expect(isError(res)).toBe(false);
    const b = body(res);
    expect(b.role.name).toBe("Moderator");
    expect(b.role.hoist).toBe(true);
  });

  it("dry run previews without writing", async () => {
    const fixture = buildHierarchyFixture();
    const mcp = await setup(fixture);
    const before = fixture.api.writes;
    const res = await mcp.callTool({
      name: "edit_role",
      arguments: { guild_id: fixture.guildId, role_id: fixture.roleIds.mod, name: "Moderator" },
    });
    const b = body(res);
    expect(b.dry_run).toBe(true);
    expect(b.after.name).toBe("Moderator");
    expect(fixture.api.writes).toBe(before);
    expect(fixture.api.roles.find((r) => r.id === fixture.roleIds.mod)!.name).toBe("Mod");
  });
});

describe("edit_role_position", () => {
  it("previews a position change without writing (dry_run default)", async () => {
    const fixture = buildHierarchyFixture();
    const mcp = await setup(fixture);
    const before = fixture.api.writes;
    const res = await mcp.callTool({
      name: "edit_role_position",
      arguments: { guild_id: fixture.guildId, role_id: fixture.roleIds.mod, position: 1 },
    });
    const b = body(res);
    expect(b.dry_run).toBe(true);
    expect(b.position_before).toBe(2);
    expect(b.position_requested).toBe(1);
    expect(fixture.api.writes).toBe(before);
  });

  it("applies a position change (dry_run=false)", async () => {
    const fixture = buildHierarchyFixture();
    const mcp = await setup(fixture);
    const res = await mcp.callTool({
      name: "edit_role_position",
      arguments: {
        guild_id: fixture.guildId,
        role_id: fixture.roleIds.mod,
        position: 1,
        dry_run: false,
      },
    });
    const b = body(res);
    expect(b.position_after).toBe(1);
    expect(fixture.api.roles.find((r) => r.id === fixture.roleIds.mod)!.position).toBe(1);
  });

  it("rejects moving a role above the bot's highest role", async () => {
    const fixture = buildHierarchyFixture();
    const mcp = await setup(fixture);
    const res = await mcp.callTool({
      name: "edit_role_position",
      arguments: { guild_id: fixture.guildId, role_id: fixture.roleIds.owner, position: 1 },
    });
    expect(isError(res)).toBe(true);
    expect(body(res).error.type).toBe("ROLE_HIERARCHY_BLOCKED");
  });

  it("rejects moving the bot's own role", async () => {
    const fixture = buildHierarchyFixture();
    const mcp = await setup(fixture);
    const res = await mcp.callTool({
      name: "edit_role_position",
      arguments: { guild_id: fixture.guildId, role_id: fixture.roleIds.bullhausAi, position: 1 },
    });
    expect(isError(res)).toBe(true);
    expect(body(res).error.type).toBe("SELF_ROLE_EDIT_BLOCKED");
  });

  it("rejects moving @everyone", async () => {
    const fixture = buildHierarchyFixture();
    const mcp = await setup(fixture);
    const res = await mcp.callTool({
      name: "edit_role_position",
      arguments: { guild_id: fixture.guildId, role_id: fixture.roleIds.everyone, position: 1 },
    });
    expect(isError(res)).toBe(true);
    expect(body(res).error.type).toBe("ROLE_HIERARCHY_BLOCKED");
  });
});
