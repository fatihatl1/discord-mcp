import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DESIGN_GUIDE_URI } from "../blueprint/design_guide.js";
import { TEMPLATES, TEMPLATE_INFO } from "../blueprint/templates.js";
import { runTool, type ToolContext } from "./shared.js";

export function registerGetBlueprintTemplate(
  server: McpServer,
  _ctx: ToolContext,
): void {
  server.registerTool(
    "get_blueprint_template",
    {
      title: "Get blueprint template",
      description:
        "Get a ready-made server blueprint for a common community type " +
        "(gaming, dev, support, creator) to use as a starting point for " +
        "apply_blueprint or create_guild -- rename and adjust instead of " +
        "designing from zero. Call without arguments to list the " +
        "available templates. The design conventions behind them live in " +
        `the ${DESIGN_GUIDE_URI} resource.`,
      inputSchema: {
        kind: z
          .string()
          .optional()
          .describe(
            "Template kind (gaming | dev | support | creator). Omit to list all.",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ kind }) =>
      runTool("get_blueprint_template", async () => {
        if (kind === undefined) {
          return {
            templates: TEMPLATE_INFO,
            note:
              "Call again with kind to get the full blueprint. Customize " +
              "names/roles/channels, then apply_blueprint with dry_run: true.",
          };
        }
        const template = TEMPLATES[kind];
        if (!template) {
          throw new Error(
            `Unknown template "${kind}". Available: ${TEMPLATE_INFO.map(
              (t) => t.kind,
            ).join(", ")}`,
          );
        }
        return {
          kind,
          blueprint: template,
          note:
            "Starting point only -- rename the server, tailor roles and " +
            "channels, then run apply_blueprint with dry_run: true to " +
            "review the plan before writing.",
        };
      }),
  );
}
