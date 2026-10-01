/** Helpers shared by every tool: context, result shaping, error mapping. */

import { BlueprintValidationError } from "../blueprint/schema.js";
import { DiscordAPIError, DryRunWriteError } from "../discord/client.js";
import type { DiscordApi } from "../discord/endpoints.js";
import {
  UnknownPermissionError,
  bitfieldToNames,
} from "../discord/permissions.js";
import { isSnowflake } from "../discord/snowflake.js";
import type { APIChannel, APIMessage, APIRole, APIWebhook } from "../discord/types.js";
import { channelTypeName, webhookTypeName } from "../discord/types.js";
import { log } from "../logging.js";

export interface ToolContext {
  api: DiscordApi;
  /** When true (DRY_RUN env), write tools describe instead of act. */
  dryRun: boolean;
}

export interface ToolTextResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

function stringify(data: unknown): string {
  return JSON.stringify(
    data,
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    2,
  );
}

export function jsonResult(data: unknown): ToolTextResult {
  return { content: [{ type: "text", text: stringify(data) }] };
}

export function errorResult(err: unknown): ToolTextResult {
  let payload: Record<string, unknown>;
  if (err instanceof DiscordAPIError) {
    payload = {
      type: "discord_api_error",
      status: err.status,
      discord_code: err.code ?? null,
      message: err.discordMessage,
      details: err.details,
      hint: err.hint ?? null,
    };
  } else if (err instanceof BlueprintValidationError) {
    payload = {
      type: "blueprint_validation_error",
      issues: err.issues,
    };
  } else if (err instanceof UnknownPermissionError) {
    payload = { type: "unknown_permission_error", message: err.message };
  } else if (err instanceof DryRunWriteError) {
    payload = { type: "dry_run_blocked", message: err.message };
  } else {
    payload = {
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  return {
    content: [{ type: "text", text: stringify({ error: payload }) }],
    isError: true,
  };
}

/**
 * Run a tool body. Failures become structured MCP error results -- never a
 * thrown exception that could kill the process or the transport.
 */
export async function runTool(
  name: string,
  fn: () => Promise<unknown>,
): Promise<ToolTextResult> {
  try {
    const data = await fn();
    // A tool body may return a fully-formed result (e.g. with isError set).
    if (
      data !== null &&
      typeof data === "object" &&
      Array.isArray((data as ToolTextResult).content)
    ) {
      return data as ToolTextResult;
    }
    return jsonResult(data);
  } catch (err) {
    log.error(`tool ${name} failed`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return errorResult(err);
  }
}

/** Role formatted for tool output: bitfield decoded to permission names. */
export function publicRole(role: APIRole): Record<string, unknown> {
  return {
    id: role.id,
    name: role.name,
    color: `#${role.color.toString(16).padStart(6, "0")}`,
    hoist: role.hoist,
    mentionable: role.mentionable,
    position: role.position,
    managed: role.managed,
    permissions: bitfieldToNames(role.permissions),
  };
}

/** Channel formatted for tool output. */
export function publicChannel(
  channel: APIChannel,
  parentNameById?: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: channel.id,
    name: channel.name,
    type: channelTypeName(channel.type),
    position: channel.position ?? null,
    parent_id: channel.parent_id ?? null,
  };
  if (parentNameById && channel.parent_id) {
    out["parent_name"] = parentNameById.get(channel.parent_id) ?? null;
  }
  if (channel.topic !== undefined && channel.topic !== null) {
    out["topic"] = channel.topic;
  }
  if (channel.nsfw !== undefined) out["nsfw"] = channel.nsfw;
  if (channel.rate_limit_per_user !== undefined) {
    out["rate_limit_per_user"] = channel.rate_limit_per_user;
  }
  if (channel.permission_overwrites) {
    out["permission_overwrites"] = channel.permission_overwrites.map((ow) => ({
      id: ow.id,
      type: ow.type === 0 ? "role" : "member",
      allow: bitfieldToNames(ow.allow),
      deny: bitfieldToNames(ow.deny),
    }));
  }
  return out;
}

/**
 * Message formatted for tool output. Only ever built from fields we know
 * about on APIMessage -- never a raw passthrough of Discord's response --
 * so nothing sensitive (e.g. a webhook token) can leak even if a future
 * Discord response shape adds one.
 */
export function publicMessage(message: APIMessage): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: message.id,
    channel_id: message.channel_id,
    author: {
      id: message.author.id,
      username: message.author.username,
      bot: message.author.bot ?? false,
    },
    is_webhook: message.webhook_id !== undefined,
    pinned: message.pinned,
    timestamp: message.timestamp,
    edited_timestamp: message.edited_timestamp ?? null,
    content: message.content,
  };
  if (message.embeds && message.embeds.length > 0) {
    out["embeds"] = message.embeds.map((embed) => ({
      type: embed.type ?? null,
      title: embed.title ?? null,
      description: embed.description ?? null,
      url: embed.url ?? null,
      color: embed.color ?? null,
      field_count: embed.fields?.length ?? 0,
    }));
  }
  return out;
}

export { SNOWFLAKE_RE as SNOWFLAKE } from "../discord/snowflake.js";

export { isSnowflake };

/**
 * Webhook formatted for tool output. Deliberately allow-listed: `token` and
 * `url` (the bearer credential and the URL that embeds it) are never read
 * off the input object, so a future Discord response field can't leak one
 * by accident the way a raw passthrough could.
 */
export function publicWebhook(webhook: APIWebhook): Record<string, unknown> {
  return {
    id: webhook.id,
    name: webhook.name,
    type: webhookTypeName(webhook.type),
    guild_id: webhook.guild_id ?? null,
    channel_id: webhook.channel_id,
    application_id: webhook.application_id ?? null,
    creator_id: webhook.user?.id ?? null,
  };
}
