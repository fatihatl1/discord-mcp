import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { BULLHAUS_GUILD_ID } from "../src/config/bullhaus.js";
import { DiscordAPIError } from "../src/discord/client.js";
import type { CreateWebhookPayload } from "../src/discord/endpoints.js";
import type { APIWebhook } from "../src/discord/types.js";
import { buildServer } from "../src/server.js";
import { FakeApi } from "./helpers.js";

const OTHER_GUILD_ID = "999999999999999999";
const CHANNEL_ID = "500000000000000001";
const OTHER_CHANNEL_ID = "500000000000000099";
const WEBHOOK_NAME = "BULLHAUS News";

async function setup(api: FakeApi = new FakeApi()) {
  const server = buildServer({ api, dryRun: false });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
  // Seed a channel in the configured BULLHAUS guild for create_webhook to find.
  api.channels.push({
    id: CHANNEL_ID,
    type: 0,
    guild_id: BULLHAUS_GUILD_ID,
    name: "bullhaus-news",
  });
  return { mcp, api };
}

function resultText(res: unknown): string {
  const content = (res as { content: Array<{ type: string; text: string }> }).content;
  return content[0]?.text ?? "";
}

function isError(res: unknown): boolean {
  return Boolean((res as { isError?: boolean }).isError);
}

async function createWebhook(mcp: Client, overrides: Record<string, unknown> = {}) {
  return mcp.callTool({
    name: "create_webhook",
    arguments: {
      guild_id: BULLHAUS_GUILD_ID,
      channel_id: CHANNEL_ID,
      name: WEBHOOK_NAME,
      confirm_create: true,
      ...overrides,
    },
  });
}

describe("list_webhooks", () => {
  it("returns sanitized metadata for the configured guild, never a token or url", async () => {
    const { mcp, api } = await setup();
    await createWebhook(mcp);

    const res = await mcp.callTool({
      name: "list_webhooks",
      arguments: { guild_id: BULLHAUS_GUILD_ID },
    });
    expect(isError(res)).toBe(false);
    const text = resultText(res);
    const body = JSON.parse(text) as {
      webhook_count: number;
      webhooks: Array<Record<string, unknown>>;
    };
    expect(body.webhook_count).toBe(1);
    expect(body.webhooks[0]?.["name"]).toBe(WEBHOOK_NAME);
    expect(body.webhooks[0]?.["type"]).toBe("incoming");
    expect(body.webhooks[0]).not.toHaveProperty("token");
    expect(body.webhooks[0]).not.toHaveProperty("url");
    expect(text).not.toContain("FAKE_WEBHOOK_TOKEN_MUST_NOT_LEAK");
    expect(api.writes).toBe(1); // only the creation, list is read-only
  });

  it("rejects a guild id other than the configured BULLHAUS guild", async () => {
    const { mcp, api } = await setup();
    const res = await mcp.callTool({
      name: "list_webhooks",
      arguments: { guild_id: OTHER_GUILD_ID },
    });
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("BULLHAUS guild");
    expect(api.writes).toBe(0);
  });

  it("restricts results to the given channel_id", async () => {
    const { mcp, api } = await setup();
    await createWebhook(mcp);
    api.channels.push({
      id: OTHER_CHANNEL_ID,
      type: 0,
      guild_id: BULLHAUS_GUILD_ID,
      name: "other-channel",
    });
    await createWebhook(mcp, { channel_id: OTHER_CHANNEL_ID, name: "Other Hook" });

    const res = await mcp.callTool({
      name: "list_webhooks",
      arguments: { guild_id: BULLHAUS_GUILD_ID, channel_id: OTHER_CHANNEL_ID },
    });
    const body = JSON.parse(resultText(res)) as {
      webhook_count: number;
      webhooks: Array<{ channel_id: string }>;
    };
    expect(body.webhook_count).toBe(1);
    expect(body.webhooks[0]?.channel_id).toBe(OTHER_CHANNEL_ID);
  });

  it("rejects an invalid (non-snowflake) guild id at the schema layer", async () => {
    const { mcp } = await setup();
    const res = await mcp.callTool({
      name: "list_webhooks",
      arguments: { guild_id: "not-a-snowflake" },
    });
    expect(isError(res)).toBe(true);
  });
});

describe("create_webhook", () => {
  it("creates a webhook and returns only sanitized metadata", async () => {
    const { mcp, api } = await setup();
    const res = await createWebhook(mcp);
    expect(isError(res)).toBe(false);
    const text = resultText(res);
    const body = JSON.parse(text) as { webhook: Record<string, unknown> };
    expect(body.webhook["name"]).toBe(WEBHOOK_NAME);
    expect(body.webhook["channel_id"]).toBe(CHANNEL_ID);
    expect(body.webhook).not.toHaveProperty("token");
    expect(body.webhook).not.toHaveProperty("url");
    expect(text).not.toContain("FAKE_WEBHOOK_TOKEN_MUST_NOT_LEAK");
    expect(api.webhooks).toHaveLength(1);
  });

  it("rejects a guild id other than the configured BULLHAUS guild before any write", async () => {
    const { mcp, api } = await setup();
    const res = await createWebhook(mcp, { guild_id: OTHER_GUILD_ID });
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("BULLHAUS guild");
    expect(api.writes).toBe(0);
  });

  it("rejects a channel that does not belong to the guild", async () => {
    const { mcp, api } = await setup();
    const res = await createWebhook(mcp, { channel_id: "500000000000099999" });
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("does not belong to guild");
    expect(api.writes).toBe(0);
  });

  it("rejects an invalid channel id at the schema layer", async () => {
    const { mcp, api } = await setup();
    const res = await createWebhook(mcp, { channel_id: "short" });
    expect(isError(res)).toBe(true);
    expect(api.writes).toBe(0);
  });

  it("rejects a reserved/invalid webhook name", async () => {
    const { mcp, api } = await setup();
    const res = await createWebhook(mcp, { name: "discord" });
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("invalid name");
    expect(api.writes).toBe(0);
  });

  it("requires confirm_create=true", async () => {
    const { mcp, api } = await setup();
    const res = await createWebhook(mcp, { confirm_create: false });
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("confirm_create");
    expect(api.writes).toBe(0);
  });

  it("dry run mode never calls the API and never returns a token", async () => {
    const { mcp, api } = await setup();
    const server = buildServer({ api, dryRun: true });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const dryMcp = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), dryMcp.connect(clientTransport)]);

    const res = await createWebhook(dryMcp);
    const body = JSON.parse(resultText(res)) as { dry_run: boolean };
    expect(body.dry_run).toBe(true);
    expect(api.writes).toBe(0);
    expect(api.webhooks).toHaveLength(0);
  });

  it("surfaces a Discord permission error safely, without leaking secrets", async () => {
    const { mcp, api } = await setup();
    api.createWebhook = async (): Promise<APIWebhook> => {
      throw new DiscordAPIError({
        status: 403,
        code: 50013,
        discordMessage: "Missing Permissions",
        details: [],
        hint: "Missing Permissions: the bot lacks MANAGE_WEBHOOKS.",
        method: "POST",
        path: `/channels/${CHANNEL_ID}/webhooks`,
      });
    };
    const res = await createWebhook(mcp);
    expect(isError(res)).toBe(true);
    const body = JSON.parse(resultText(res)) as {
      error: { type: string; status: number; discord_code: number };
    };
    expect(body.error.type).toBe("discord_api_error");
    expect(body.error.status).toBe(403);
    expect(body.error.discord_code).toBe(50013);
  });

  it("surfaces a network error safely", async () => {
    const { mcp, api } = await setup();
    api.createWebhook = async (): Promise<APIWebhook> => {
      throw new DiscordAPIError({
        status: 0,
        code: undefined,
        discordMessage: "Network error after 5 attempts: fetch failed",
        details: [],
        hint: "Check network connectivity to discord.com.",
        method: "POST",
        path: `/channels/${CHANNEL_ID}/webhooks`,
      });
    };
    const res = await createWebhook(mcp);
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("Network error");
  });
});

describe("delete_webhook", () => {
  async function seedWebhook(api: FakeApi): Promise<string> {
    const webhook = await api.createWebhook(
      CHANNEL_ID,
      { name: WEBHOOK_NAME } satisfies CreateWebhookPayload,
      "seed",
    );
    return webhook.id;
  }

  it("deletes only after guild/name/channel identity checks pass", async () => {
    const { mcp, api } = await setup();
    const webhookId = await seedWebhook(api);
    const writesBefore = api.writes;

    const res = await mcp.callTool({
      name: "delete_webhook",
      arguments: {
        guild_id: BULLHAUS_GUILD_ID,
        webhook_id: webhookId,
        expected_webhook_name: WEBHOOK_NAME,
        expected_channel_id: CHANNEL_ID,
        confirm_delete: true,
      },
    });
    expect(isError(res)).toBe(false);
    const body = JSON.parse(resultText(res)) as { deleted_webhook_id: string };
    expect(body.deleted_webhook_id).toBe(webhookId);
    expect(api.webhooks).toHaveLength(0);
    expect(api.writes).toBe(writesBefore + 1);
  });

  it("rejects a guild id other than the configured BULLHAUS guild", async () => {
    const { mcp, api } = await setup();
    const webhookId = await seedWebhook(api);
    const res = await mcp.callTool({
      name: "delete_webhook",
      arguments: {
        guild_id: OTHER_GUILD_ID,
        webhook_id: webhookId,
        expected_webhook_name: WEBHOOK_NAME,
        expected_channel_id: CHANNEL_ID,
        confirm_delete: true,
      },
    });
    expect(isError(res)).toBe(true);
    expect(api.webhooks).toHaveLength(1); // untouched
  });

  it("rejects on webhook name mismatch and does not delete", async () => {
    const { mcp, api } = await setup();
    const webhookId = await seedWebhook(api);
    const res = await mcp.callTool({
      name: "delete_webhook",
      arguments: {
        guild_id: BULLHAUS_GUILD_ID,
        webhook_id: webhookId,
        expected_webhook_name: "Wrong Name",
        expected_channel_id: CHANNEL_ID,
        confirm_delete: true,
      },
    });
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("name mismatch");
    expect(api.webhooks).toHaveLength(1);
  });

  it("rejects on destination channel mismatch and does not delete", async () => {
    const { mcp, api } = await setup();
    const webhookId = await seedWebhook(api);
    const res = await mcp.callTool({
      name: "delete_webhook",
      arguments: {
        guild_id: BULLHAUS_GUILD_ID,
        webhook_id: webhookId,
        expected_webhook_name: WEBHOOK_NAME,
        expected_channel_id: OTHER_CHANNEL_ID,
        confirm_delete: true,
      },
    });
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("channel mismatch");
    expect(api.webhooks).toHaveLength(1);
  });

  it("requires confirm_delete=true even when identity checks pass", async () => {
    const { mcp, api } = await setup();
    const webhookId = await seedWebhook(api);
    const res = await mcp.callTool({
      name: "delete_webhook",
      arguments: {
        guild_id: BULLHAUS_GUILD_ID,
        webhook_id: webhookId,
        expected_webhook_name: WEBHOOK_NAME,
        expected_channel_id: CHANNEL_ID,
        confirm_delete: false,
      },
    });
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("confirm_delete");
    expect(api.webhooks).toHaveLength(1);
  });

  it("dry run mode never calls deleteWebhook", async () => {
    const { api } = await setup();
    const webhookId = await seedWebhook(api);
    const server = buildServer({ api, dryRun: true });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const dryMcp = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), dryMcp.connect(clientTransport)]);

    const writesBefore = api.writes;
    const res = await dryMcp.callTool({
      name: "delete_webhook",
      arguments: {
        guild_id: BULLHAUS_GUILD_ID,
        webhook_id: webhookId,
        expected_webhook_name: WEBHOOK_NAME,
        expected_channel_id: CHANNEL_ID,
        confirm_delete: true,
      },
    });
    const body = JSON.parse(resultText(res)) as { dry_run: boolean };
    expect(body.dry_run).toBe(true);
    expect(api.writes).toBe(writesBefore); // getWebhook is not tracked as a write
    expect(api.webhooks).toHaveLength(1);
  });

  it("on a timed-out delete, re-checks existence instead of blindly retrying: confirms success once gone", async () => {
    const { mcp, api } = await setup();
    const webhookId = await seedWebhook(api);
    const realGetWebhook = api.getWebhook.bind(api);
    let deleteAttempts = 0;
    api.deleteWebhook = async (id: string): Promise<void> => {
      deleteAttempts++;
      api.webhooks = api.webhooks.filter((w) => w.id !== id); // it actually landed server-side
      throw new DiscordAPIError({
        status: 0,
        code: undefined,
        discordMessage: "Network error after 5 attempts: timeout",
        details: [],
        hint: undefined,
        method: "DELETE",
        path: `/webhooks/${id}`,
      });
    };
    api.getWebhook = async (id: string): Promise<APIWebhook> => {
      try {
        return await realGetWebhook(id);
      } catch {
        throw new DiscordAPIError({
          status: 404,
          code: 10015,
          discordMessage: "Unknown Webhook",
          details: [],
          hint: undefined,
          method: "GET",
          path: `/webhooks/${id}`,
        });
      }
    };

    const res = await mcp.callTool({
      name: "delete_webhook",
      arguments: {
        guild_id: BULLHAUS_GUILD_ID,
        webhook_id: webhookId,
        expected_webhook_name: WEBHOOK_NAME,
        expected_channel_id: CHANNEL_ID,
        confirm_delete: true,
      },
    });
    expect(isError(res)).toBe(false);
    const body = JSON.parse(resultText(res)) as { result: string };
    expect(body.result).toBe("deleted");
    expect(deleteAttempts).toBe(1); // never blindly retried
  });

  it("on a timed-out delete, does not report success if the webhook still exists", async () => {
    const { mcp, api } = await setup();
    const webhookId = await seedWebhook(api);
    api.deleteWebhook = async (): Promise<void> => {
      throw new DiscordAPIError({
        status: 0,
        code: undefined,
        discordMessage: "Network error after 5 attempts: timeout",
        details: [],
        hint: undefined,
        method: "DELETE",
        path: `/webhooks/${webhookId}`,
      });
    };
    // getWebhook (the real FakeApi implementation) still finds it -> inconclusive/still there.

    const res = await mcp.callTool({
      name: "delete_webhook",
      arguments: {
        guild_id: BULLHAUS_GUILD_ID,
        webhook_id: webhookId,
        expected_webhook_name: WEBHOOK_NAME,
        expected_channel_id: CHANNEL_ID,
        confirm_delete: true,
      },
    });
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("Network error");
    expect(api.webhooks).toHaveLength(1); // still there; not falsely reported deleted
  });
});
