import { describe, expect, it } from "vitest";
import { buildPlan } from "../src/blueprint/plan.js";
import { validateBlueprint } from "../src/blueprint/schema.js";
import { TEMPLATES, TEMPLATE_INFO } from "../src/blueprint/templates.js";
import { DESIGN_GUIDE } from "../src/blueprint/design_guide.js";
import type { APIRole } from "../src/discord/types.js";

const GUILD_ID = "100000000000000001";

function emptyLive(): { guildId: string; roles: APIRole[]; channels: [] } {
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

describe("blueprint templates", () => {
  it("info list and template map stay in sync", () => {
    expect(TEMPLATE_INFO.map((t) => t.kind).sort()).toEqual(
      Object.keys(TEMPLATES).sort(),
    );
  });

  for (const info of TEMPLATE_INFO) {
    it(`"${info.kind}" template validates and plans cleanly`, () => {
      const template = TEMPLATES[info.kind];
      expect(template).toBeDefined();
      // Must survive the full validation pass (role refs, permissions,
      // duplicates, contradictions)...
      const normalized = validateBlueprint(template);
      // ...and produce a usable plan against an empty guild.
      const plan = buildPlan(normalized, emptyLive(), "reconcile");
      expect(plan.operations.length).toBeGreaterThan(0);
      expect(plan.warnings).toEqual([]);
      // Design-guide conventions: INFORMATION category first, staff area
      // private, Admin role on top.
      expect(normalized.categories[0]?.name).toBe("INFORMATION");
      expect(normalized.roles[0]?.name).toBe("Admin");
      const staff = normalized.categories.find((c) =>
        c.overwrites.some((ow) => ow.role === "@everyone" && ow.deny > 0n),
      );
      expect(staff, `${info.kind} needs a private area`).toBeDefined();
    });
  }

  it("design guide mentions the workflow essentials", () => {
    expect(DESIGN_GUIDE).toContain("dry_run");
    expect(DESIGN_GUIDE).toContain("private_to");
    expect(DESIGN_GUIDE).toContain("ADMINISTRATOR");
  });
});
