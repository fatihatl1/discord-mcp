import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { DiscordClient } from "../src/discord/client.js";
import { DiscordEndpoints } from "../src/discord/endpoints.js";
import { MESSAGE_FLAGS } from "../src/discord/types.js";
import { buildServer } from "../src/server.js";
import { fetchStub, FakeApi } from "./helpers.js";

const CHANNEL_ID = "500000000000000001";

async function setup(api: FakeApi = new FakeApi()) {
  const server = buildServer({ api, dryRun: false });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
  return { mcp, api };
}

function resultText(res: unknown): string {
  const content = (res as { content: Array<{ type: string; text: string }> }).content;
  return content[0]?.text ?? "";
}

describe("send_message: normal sending (backward compatibility)", () => {
  it("sends without any flags when suppress_embeds is omitted", async () => {
    const { mcp, api } = await setup();
    const res = await mcp.callTool({
      name: "send_message",
      arguments: { channel_id: CHANNEL_ID, content: "hello" },
    });
    expect((res as { isError?: boolean }).isError).toBeFalsy();
    const body = JSON.parse(resultText(res)) as {
      message_id: string;
      channel_id: string;
      timestamp: string;
    };
    expect(body.channel_id).toBe(CHANNEL_ID);
    expect(body.message_id).toBeTruthy();
    expect(api.messages[0]?.flags).toBeUndefined();
  });

  it("sends without any flags when suppress_embeds is explicitly false", async () => {
    const { mcp, api } = await setup();
    await mcp.callTool({
      name: "send_message",
      arguments: { channel_id: CHANNEL_ID, content: "hello", suppress_embeds: false },
    });
    expect(api.messages[0]?.flags).toBeUndefined();
  });
});

describe("send_message: suppress_embeds", () => {
  it("sets the SUPPRESS_EMBEDS message flag when true", async () => {
    const { mcp, api } = await setup();
    const res = await mcp.callTool({
      name: "send_message",
      arguments: {
        channel_id: CHANNEL_ID,
        content: "https://example.com/some-article",
        suppress_embeds: true,
      },
    });
    expect((res as { isError?: boolean }).isError).toBeFalsy();
    expect(api.messages[0]?.flags).toBe(MESSAGE_FLAGS.SUPPRESS_EMBEDS);
    expect(api.messages[0]?.flags).toBe(4);
  });

  it("dry run reports suppress_embeds in the preview without sending", async () => {
    const api = new FakeApi();
    const server = buildServer({ api, dryRun: true });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcp = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);

    const res = await mcp.callTool({
      name: "send_message",
      arguments: { channel_id: CHANNEL_ID, content: "hi", suppress_embeds: true },
    });
    const body = JSON.parse(resultText(res)) as {
      dry_run: boolean;
      would_send_message: { suppress_embeds: boolean };
    };
    expect(body.dry_run).toBe(true);
    expect(body.would_send_message.suppress_embeds).toBe(true);
    expect(api.messages).toHaveLength(0);
  });
});

describe("send_message: raw Discord request payload", () => {
  it("includes flags: 4 in the JSON body only when suppress_embeds is true", async () => {
    const { fn, calls } = fetchStub(() => ({
      status: 200,
      body: {
        id: "1",
        channel_id: CHANNEL_ID,
        author: { id: "1", username: "bot", discriminator: "0", bot: true },
        content: "x",
        timestamp: new Date(0).toISOString(),
        pinned: false,
        type: 0,
      },
    }));
    const client = new DiscordClient({ token: "t", fetchFn: fn, writeDelayMs: 0 });
    const api = new DiscordEndpoints(client);

    await api.createMessage(CHANNEL_ID, { content: "no preview", flags: 4 });
    await api.createMessage(CHANNEL_ID, { content: "normal" });

    expect(calls[0]?.body).toEqual({ content: "no preview", flags: 4 });
    expect(calls[1]?.body).toEqual({ content: "normal" });
    expect(calls[1]?.body).not.toHaveProperty("flags");
  });
});
