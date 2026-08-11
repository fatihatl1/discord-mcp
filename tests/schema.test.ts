import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "../src/discord/permissions.js";
import {
  BlueprintValidationError,
  validateBlueprint,
} from "../src/blueprint/schema.js";
import { EXAMPLE_BLUEPRINT } from "./helpers.js";

describe("blueprint validation", () => {
  it("accepts the worked example and normalises it", () => {
    const bp = validateBlueprint(EXAMPLE_BLUEPRINT);
    expect(bp.name).toBe("Example Server");
    expect(bp.roles.map((r) => r.name)).toEqual(["Admin", "Member"]);
    expect(bp.everyonePermissions).toBe(
      PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.READ_MESSAGE_HISTORY,
    );

    const staff = bp.categories[1];
    expect(staff?.name).toBe("STAFF");
    // private_to: [Admin] => @everyone denied VIEW_CHANNEL, Admin allowed.
    expect(staff?.overwrites).toEqual([
      { role: "@everyone", allow: 0n, deny: PERMISSIONS.VIEW_CHANNEL },
      { role: "Admin", allow: PERMISSIONS.VIEW_CHANNEL, deny: 0n },
    ]);
    // Children inherit the category overwrites when they add nothing.
    expect(staff?.channels[0]?.overwrites).toEqual(staff?.overwrites);

    // locked => @everyone denied SEND_MESSAGES; empty private_to = public.
    const info = bp.categories[0];
    expect(info?.overwrites).toEqual([]);
    expect(info?.channels[0]?.overwrites).toEqual([
      { role: "@everyone", allow: 0n, deny: PERMISSIONS.SEND_MESSAGES },
    ]);
  });

  it("accepts a JSON string blueprint", () => {
    const bp = validateBlueprint(JSON.stringify(EXAMPLE_BLUEPRINT));
    expect(bp.name).toBe("Example Server");
  });

  it("rejects a private_to reference to an undefined role", () => {
    const bad = {
      name: "Bad Server",
      roles: [{ name: "Admin" }],
      categories: [
        { name: "STAFF", private_to: ["Moderator"], channels: [] },
      ],
    };
    try {
      validateBlueprint(bad);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(BlueprintValidationError);
      const issues = (err as BlueprintValidationError).issues.join("\n");
      expect(issues).toContain("Moderator");
      expect(issues).toContain("not defined in roles[]");
    }
  });

  it("rejects an overwrite reference to an undefined role", () => {
    const bad = {
      name: "Bad Server",
      roles: [],
      categories: [
        {
          name: "GENERAL",
          channels: [
            {
              name: "chat",
              overwrites: [{ role: "Ghost", allow: ["VIEW_CHANNEL"] }],
            },
          ],
        },
      ],
    };
    expect(() => validateBlueprint(bad)).toThrow(/Ghost/);
  });

  it("rejects unknown permission names, listing valid options", () => {
    const bad = {
      name: "Bad Server",
      roles: [{ name: "Admin", permissions: ["ADMINISTRATE"] }],
    };
    try {
      validateBlueprint(bad);
      expect.unreachable();
    } catch (err) {
      const issues = (err as BlueprintValidationError).issues.join("\n");
      expect(issues).toContain("ADMINISTRATE");
      expect(issues).toContain("ADMINISTRATOR");
    }
  });

  it("rejects duplicate role names and duplicate channels in a category", () => {
    const bad = {
      name: "Bad Server",
      roles: [{ name: "Admin" }, { name: "Admin" }],
      categories: [
        {
          name: "GENERAL",
          channels: [{ name: "Chat Room" }, { name: "chat-room" }],
        },
      ],
    };
    try {
      validateBlueprint(bad);
      expect.unreachable();
    } catch (err) {
      const issues = (err as BlueprintValidationError).issues.join("\n");
      expect(issues).toContain('duplicate role name "Admin"');
      expect(issues).toContain('duplicate channel name "chat-room"');
    }
  });

  it("rejects contradictory overwrites at the same level", () => {
    const bad = {
      name: "Bad Server",
      roles: [],
      categories: [
        {
          name: "GENERAL",
          channels: [
            {
              name: "chat",
              locked: true,
              overwrites: [{ role: "@everyone", allow: ["SEND_MESSAGES"] }],
            },
          ],
        },
      ],
    };
    expect(() => validateBlueprint(bad)).toThrow(/allow and deny SEND_MESSAGES/);
  });

  it("lets a child override an inherited deny (child wins per bit)", () => {
    const bp = validateBlueprint({
      name: "Override Server",
      roles: [{ name: "Admin" }],
      categories: [
        {
          name: "STAFF",
          private_to: ["Admin"],
          channels: [
            {
              name: "public-window",
              overwrites: [{ role: "@everyone", allow: ["VIEW_CHANNEL"] }],
            },
          ],
        },
      ],
    });
    const child = bp.categories[0]?.channels[0];
    // The category's deny VIEW_CHANNEL is flipped to allow by the child.
    expect(child?.overwrites).toEqual([
      { role: "@everyone", allow: PERMISSIONS.VIEW_CHANNEL, deny: 0n },
      { role: "Admin", allow: PERMISSIONS.VIEW_CHANNEL, deny: 0n },
    ]);
  });

  it("rejects unknown fields (typo protection)", () => {
    const bad = {
      name: "Bad Server",
      roles: [{ name: "Admin", premissions: ["ADMINISTRATOR"] }],
    };
    expect(() => validateBlueprint(bad)).toThrow(BlueprintValidationError);
  });

  it("rejects blueprints that are not valid JSON when given as a string", () => {
    expect(() => validateBlueprint("{not json")).toThrow(/not valid JSON/);
  });
});
