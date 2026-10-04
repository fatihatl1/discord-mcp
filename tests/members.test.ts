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

function withExtraMembers(fixture: HierarchyFixture): HierarchyFixture {
  fixture.api.members.push(
    {
      user: {
        id: "500000000000000001",
        username: "alice",
        discriminator: "0",
        global_name: "Alice",
        bot: false,
      },
      nick: "Ali",
      roles: [fixture.roleIds.mod],
      joined_at: new Date(1000).toISOString(),
    },
    {
      user: {
        id: "500000000000000002",
        username: "bob",
        discriminator: "0",
        bot: false,
      },
      roles: [],
      joined_at: new Date(2000).toISOString(),
    },
    {
      user: {
        id: "500000000000000003",
        username: "news-bot",
        discriminator: "0",
        bot: true,
      },
      roles: [fixture.roleIds.mod],
      joined_at: new Date(3000).toISOString(),
    },
  );
  return fixture;
}

describe("get_member", () => {
  it("resolves a member's identity and roles", async () => {
    const fixture = withExtraMembers(buildHierarchyFixture());
    const mcp = await setup(fixture);
    const res = await mcp.callTool({
      name: "get_member",
      arguments: { guild_id: fixture.guildId, user_id: "500000000000000001" },
    });
    expect(isError(res)).toBe(false);
    const b = body(res);
    expect(b.member.username).toBe("alice");
    expect(b.member.nickname).toBe("Ali");
    expect(b.member.bot).toBe(false);
    expect(b.member.role_ids).toEqual([fixture.roleIds.mod]);
    expect(b.member.role_names).toEqual(["Mod"]);
  });

  it("returns MEMBER_NOT_FOUND for an unknown user", async () => {
    const fixture = buildHierarchyFixture();
    const mcp = await setup(fixture);
    const res = await mcp.callTool({
      name: "get_member",
      arguments: { guild_id: fixture.guildId, user_id: "999999999999999999" },
    });
    expect(isError(res)).toBe(true);
    expect(body(res).error.type).toBe("MEMBER_NOT_FOUND");
  });
});

describe("list_role_members", () => {
  it("returns only members carrying the given role, distinguishing bots from humans", async () => {
    const fixture = withExtraMembers(buildHierarchyFixture());
    const mcp = await setup(fixture);
    const res = await mcp.callTool({
      name: "list_role_members",
      arguments: { guild_id: fixture.guildId, role_id: fixture.roleIds.mod },
    });
    expect(isError(res)).toBe(false);
    const b = body(res);
    expect(b.matching_member_count).toBe(2);
    const ids = b.members.map((m: any) => m.id).sort();
    expect(ids).toEqual(["500000000000000001", "500000000000000003"].sort());
    const bots = b.members.filter((m: any) => m.bot);
    const humans = b.members.filter((m: any) => !m.bot);
    expect(bots).toHaveLength(1);
    expect(humans).toHaveLength(1);
    expect(bots[0].username).toBe("news-bot");
  });

  it("@everyone (role_id == guild_id) matches every member", async () => {
    const fixture = withExtraMembers(buildHierarchyFixture());
    const mcp = await setup(fixture);
    const res = await mcp.callTool({
      name: "list_role_members",
      arguments: { guild_id: fixture.guildId, role_id: fixture.guildId },
    });
    const b = body(res);
    // bot + alice + bob + news-bot
    expect(b.matching_member_count).toBe(4);
  });

  it("excludes members without the role", async () => {
    const fixture = withExtraMembers(buildHierarchyFixture());
    const mcp = await setup(fixture);
    const res = await mcp.callTool({
      name: "list_role_members",
      arguments: { guild_id: fixture.guildId, role_id: fixture.roleIds.owner },
    });
    const b = body(res);
    expect(b.matching_member_count).toBe(0);
    expect(b.members).toEqual([]);
  });

  it("surfaces a disabled GUILD_MEMBERS intent as a structured error, not an empty list", async () => {
    const fixture = buildHierarchyFixture();
    fixture.api.guildMembersIntentDisabled = true;
    const mcp = await setup(fixture);
    const res = await mcp.callTool({
      name: "list_role_members",
      arguments: { guild_id: fixture.guildId, role_id: fixture.roleIds.mod },
    });
    expect(isError(res)).toBe(true);
    expect(body(res).error.type).toBe("GUILD_MEMBERS_INTENT_REQUIRED");
  });
});
