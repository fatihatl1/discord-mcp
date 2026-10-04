import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
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

describe("get_effective_permissions tool wiring", () => {
  it("evaluates a real member via user_id", async () => {
    const fixture = buildHierarchyFixture(["KICK_MEMBERS"]);
    fixture.api.members.push({
      user: { id: "500000000000000001", username: "alice", discriminator: "0", bot: false },
      roles: [fixture.roleIds.mod],
      joined_at: new Date(0).toISOString(),
    });
    const mcp = await setup(fixture);
    const res = await mcp.callTool({
      name: "get_effective_permissions",
      arguments: { guild_id: fixture.guildId, user_id: "500000000000000001" },
    });
    expect(isError(res)).toBe(false);
    const b = body(res);
    expect(b.server_permissions).toContain("KICK_MEMBERS");
    expect(b.contributing_roles.map((r: any) => r.name)).toEqual(["Mod"]);
  });

  it("evaluates a hypothetical role set via role_ids", async () => {
    const fixture = buildHierarchyFixture(["KICK_MEMBERS"]);
    const mcp = await setup(fixture);
    const res = await mcp.callTool({
      name: "get_effective_permissions",
      arguments: { guild_id: fixture.guildId, role_ids: [fixture.roleIds.mod] },
    });
    expect(isError(res)).toBe(false);
    expect(body(res).server_permissions).toContain("KICK_MEMBERS");
  });

  it("also computes channel-level permissions, resolving the parent category automatically", async () => {
    const fixture = buildHierarchyFixture();
    fixture.api.channels = [
      {
        id: "600000000000000001",
        type: 4,
        name: "STAFF",
        permission_overwrites: [
          { id: fixture.guildId, type: 0, allow: "0", deny: "1024" }, // deny VIEW_CHANNEL
        ],
      },
      {
        id: "600000000000000002",
        type: 0,
        name: "staff-chat",
        parent_id: "600000000000000001",
        permission_overwrites: [
          { id: fixture.roleIds.mod, type: 0, allow: "1024", deny: "0" }, // allow VIEW_CHANNEL
        ],
      },
    ];
    const mcp = await setup(fixture);
    const res = await mcp.callTool({
      name: "get_effective_permissions",
      arguments: {
        guild_id: fixture.guildId,
        role_ids: [fixture.roleIds.mod],
        channel_id: "600000000000000002",
      },
    });
    const b = body(res);
    expect(b.channel_permissions).toContain("VIEW_CHANNEL");
  });

  it("rejects supplying both user_id and role_ids", async () => {
    const fixture = buildHierarchyFixture();
    const mcp = await setup(fixture);
    const res = await mcp.callTool({
      name: "get_effective_permissions",
      arguments: { guild_id: fixture.guildId, user_id: "1", role_ids: [] },
    });
    expect(isError(res)).toBe(true);
  });

  it("rejects supplying neither user_id nor role_ids", async () => {
    const fixture = buildHierarchyFixture();
    const mcp = await setup(fixture);
    const res = await mcp.callTool({
      name: "get_effective_permissions",
      arguments: { guild_id: fixture.guildId },
    });
    expect(isError(res)).toBe(true);
  });

  it("returns MEMBER_NOT_FOUND for an unknown user_id", async () => {
    const fixture = buildHierarchyFixture();
    const mcp = await setup(fixture);
    const res = await mcp.callTool({
      name: "get_effective_permissions",
      arguments: { guild_id: fixture.guildId, user_id: "999999999999999999" },
    });
    expect(isError(res)).toBe(true);
    expect(body(res).error.type).toBe("MEMBER_NOT_FOUND");
  });

  it("returns CHANNEL_NOT_FOUND for an unknown channel_id", async () => {
    const fixture = buildHierarchyFixture();
    const mcp = await setup(fixture);
    const res = await mcp.callTool({
      name: "get_effective_permissions",
      arguments: {
        guild_id: fixture.guildId,
        role_ids: [fixture.roleIds.mod],
        channel_id: "999999999999999999",
      },
    });
    expect(isError(res)).toBe(true);
    expect(body(res).error.type).toBe("CHANNEL_NOT_FOUND");
  });
});
