import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { BULLHAUS_GUILD_ID } from "../src/config/bullhaus.js";
import { DiscordClient, DryRunWriteError } from "../src/discord/client.js";
import { DiscordEndpoints } from "../src/discord/endpoints.js";
import { buildServer } from "../src/server.js";
import { EXAMPLE_BLUEPRINT, fetchStub, type RecordedCall } from "./helpers.js";

const GUILD_ID = "100000000000000001";
const SECRET = "SECRET_TOKEN_VALUE_abc123";

describe("DRY_RUN at the client level", () => {
  it("refuses writes before any network I/O; reads still work", async () => {
    const { fn, calls } = fetchStub(() => ({ status: 200, body: { id: "1" } }));
    const client = new DiscordClient({
      token: SECRET,
      dryRun: true,
      fetchFn: fn,
      writeDelayMs: 0,
    });
    await expect(
      client.request("POST", "/guilds", { body: { name: "x" } }),
    ).rejects.toBeInstanceOf(DryRunWriteError);
    expect(calls).toHaveLength(0);

    await client.request("GET", "/users/@me");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
  });
});

describe("DRY_RUN end to end through the MCP server", () => {
  async function setup(): Promise<{ mcp: Client; calls: RecordedCall[] }> {
    const { fn, calls } = fetchStub((call) => {
      if (call.url.endsWith("/users/@me")) {
        return {
          body: { id: "1", username: "bot", discriminator: "0", bot: true },
        };
      }
      if (call.url.includes("/users/@me/guilds")) return { body: [] };
      if (/\/guilds\/\d+\/roles$/.test(call.url)) {
        return {
          body: [
            {
              id: GUILD_ID,
              name: "@everyone",
              color: 0,
              hoist: false,
              position: 0,
              permissions: "0",
              managed: false,
              mentionable: false,
            },
          ],
        };
      }
      if (/\/guilds\/\d+\/channels$/.test(call.url)) {
        return {
          body: [{ id: "500000000000000001", type: 0, name: "general" }],
        };
      }
      if (/\/channels\/\d+\/messages\/\d+$/.test(call.url)) {
        return {
          body: {
            id: "600000000000000001",
            channel_id: "500000000000000001",
            author: { id: "1", username: "bot", discriminator: "0", bot: true },
            content: "hi",
            timestamp: new Date(0).toISOString(),
            pinned: false,
            type: 0,
          },
        };
      }
      if (/\/webhooks\/\d+$/.test(call.url)) {
        return {
          body: {
            id: "800000000000000001",
            type: 1,
            guild_id: BULLHAUS_GUILD_ID,
            channel_id: "500000000000000001",
            name: "BULLHAUS News",
          },
        };
      }
      return { body: {} };
    });

    const discord = new DiscordClient({
      token: SECRET,
      dryRun: true,
      fetchFn: fn,
      writeDelayMs: 0,
    });
    const server = buildServer({
      api: new DiscordEndpoints(discord),
      dryRun: true,
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const mcp = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([
      server.connect(serverTransport),
      mcp.connect(clientTransport),
    ]);
    return { mcp, calls };
  }

  function resultText(res: unknown): string {
    const content = (res as { content: Array<{ type: string; text: string }> })
      .content;
    return content[0]?.text ?? "";
  }

  it("zero write requests reach Discord across every write tool", async () => {
    const { mcp, calls } = await setup();

    const applyRes = await mcp.callTool({
      name: "apply_blueprint",
      arguments: {
        guild_id: GUILD_ID,
        blueprint: EXAMPLE_BLUEPRINT,
        mode: "reconcile",
        dry_run: false, // env DRY_RUN must force dry-run anyway
      },
    });
    const applyBody = JSON.parse(resultText(applyRes)) as {
      dry_run: boolean;
      forced_by_env: boolean;
      plan: { operations: unknown[] };
    };
    expect(applyBody.dry_run).toBe(true);
    expect(applyBody.forced_by_env).toBe(true);
    expect(applyBody.plan.operations.length).toBeGreaterThan(0);

    const writeCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [
      { name: "create_guild", arguments: { name: "New Server" } },
      {
        name: "create_role",
        arguments: { guild_id: GUILD_ID, name: "Mod", permissions: ["KICK_MEMBERS"] },
      },
      {
        name: "create_channel",
        arguments: { guild_id: GUILD_ID, name: "general", type: "text" },
      },
      {
        name: "set_channel_permissions",
        arguments: {
          channel_id: "500000000000000001",
          target_id: GUILD_ID,
          target_type: "role",
          deny: ["VIEW_CHANNEL"],
        },
      },
      {
        name: "reorder_roles",
        arguments: {
          guild_id: GUILD_ID,
          positions: [{ role_id: "400000000000000001", position: 3 }],
        },
      },
      {
        name: "reorder_channels",
        arguments: {
          guild_id: GUILD_ID,
          positions: [{ channel_id: "500000000000000001", position: 2 }],
        },
      },
      {
        name: "edit_channel",
        arguments: { channel_id: "500000000000000001", topic: "new topic" },
      },
      {
        name: "send_message",
        arguments: { channel_id: "500000000000000001", content: "hi" },
      },
      {
        name: "send_message",
        arguments: {
          channel_id: "500000000000000001",
          content: "hi, no preview",
          suppress_embeds: true,
        },
      },
      {
        name: "create_webhook",
        arguments: {
          guild_id: BULLHAUS_GUILD_ID,
          channel_id: "500000000000000001",
          name: "BULLHAUS News",
          confirm_create: true,
        },
      },
      {
        name: "delete_webhook",
        arguments: {
          guild_id: BULLHAUS_GUILD_ID,
          webhook_id: "800000000000000001",
          expected_webhook_name: "BULLHAUS News",
          expected_channel_id: "500000000000000001",
          confirm_delete: true,
        },
      },
      {
        name: "edit_message",
        arguments: {
          channel_id: "500000000000000001",
          message_id: "600000000000000001",
          content: "hi edited",
        },
      },
      {
        name: "pin_message",
        arguments: {
          channel_id: "500000000000000001",
          message_id: "600000000000000001",
        },
      },
      {
        name: "unpin_message",
        arguments: {
          channel_id: "500000000000000001",
          message_id: "600000000000000001",
        },
      },
      {
        name: "delete_message",
        arguments: {
          channel_id: "500000000000000001",
          message_id: "600000000000000001",
        },
      },
      {
        name: "delete_channel",
        arguments: { channel_id: "500000000000000001", confirm: true },
      },
      {
        name: "delete_role",
        arguments: {
          guild_id: GUILD_ID,
          role_id: "400000000000000001",
          confirm: true,
        },
      },
    ];

    for (const call of writeCalls) {
      const res = await mcp.callTool(call);
      const body = JSON.parse(resultText(res)) as { dry_run?: boolean };
      expect(body.dry_run, `${call.name} should report dry_run`).toBe(true);
    }

    // THE guarantee: not a single non-GET request reached the fetch layer.
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("never leaks the bot token into tool output", async () => {
    const { mcp } = await setup();
    const res = await mcp.callTool({
      name: "get_bot_info",
      arguments: {},
    });
    expect(resultText(res)).not.toContain(SECRET);
    const res2 = await mcp.callTool({
      name: "create_role",
      arguments: { guild_id: GUILD_ID, name: "Mod" },
    });
    expect(resultText(res2)).not.toContain(SECRET);
  });
});
