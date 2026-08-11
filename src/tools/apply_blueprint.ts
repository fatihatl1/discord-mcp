import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { applyPlan } from "../blueprint/apply.js";
import { buildPlan, type LiveState } from "../blueprint/plan.js";
import {
  BlueprintObjectSchema,
  validateBlueprint,
} from "../blueprint/schema.js";
import { jsonResult, runTool, SNOWFLAKE, type ToolContext } from "./shared.js";

export function registerApplyBlueprint(
  server: McpServer,
  ctx: ToolContext,
): void {
  server.registerTool(
    "apply_blueprint",
    {
      title: "Apply blueprint",
      description:
        "Diff a declarative blueprint against a guild's live roles and " +
        "channels, then apply the difference in order (roles -> role " +
        "positions -> categories -> channels -> permission overwrites). " +
        "Nothing is ever deleted; live entities missing from the blueprint " +
        "are reported as orphans. mode=create_only (default) only creates " +
        "missing entities; mode=reconcile also updates entities that " +
        "differ. With dry_run=true the full ordered plan is returned and no " +
        "write reaches Discord. Applying the same blueprint twice yields " +
        "zero operations the second time.",
      inputSchema: {
        guild_id: z.string().regex(SNOWFLAKE, "must be a Discord snowflake id"),
        blueprint: BlueprintObjectSchema,
        mode: z.enum(["create_only", "reconcile"]).default("create_only"),
        dry_run: z.boolean().default(false),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ guild_id, blueprint, mode, dry_run }) =>
      runTool("apply_blueprint", async () => {
        // Validation is a separate pass; this throws before any API call.
        const normalized = validateBlueprint(blueprint);

        const [roles, channels] = await Promise.all([
          ctx.api.listGuildRoles(guild_id),
          ctx.api.listGuildChannels(guild_id),
        ]);
        const live: LiveState = { guildId: guild_id, roles, channels };
        const plan = buildPlan(normalized, live, mode);

        const effectiveDryRun = dry_run || ctx.dryRun;
        if (effectiveDryRun) {
          return jsonResult({
            dry_run: true,
            forced_by_env: !dry_run && ctx.dryRun,
            mode,
            plan,
            note:
              plan.operations.length === 0
                ? "Guild already matches the blueprint; nothing to do."
                : `${plan.operations.length} operation(s) would be applied. No write was sent to Discord.`,
          });
        }

        const result = await applyPlan(ctx.api, guild_id, plan, live);
        const body = {
          mode,
          summary: plan.summary,
          applied: result.results,
          orphans: plan.orphans,
          skipped: plan.skipped,
          warnings: plan.warnings,
          completed: result.completed,
          ...(result.error ? { error: result.error } : {}),
        };
        if (!result.completed) {
          return { ...jsonResult(body), isError: true };
        }
        return body;
      }),
  );
}
