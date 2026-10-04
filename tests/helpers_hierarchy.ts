/**
 * Shared guild/role/member fixture for the role-management and
 * effective-permissions test suites: a guild with a predictable hierarchy so
 * every safety-boundary outcome (self-role, hierarchy, managed-role
 * rejection, ordinary success) can be exercised deterministically.
 *
 * Position layout (0 = bottom):
 *   0 @everyone
 *   1 Booster        (managed=true,  NOT the bot's own role)
 *   2 Mod            (ordinary role, editable by the bot)
 *   3 BULLHAUS AI    (managed=true,  the bot's own role)
 *   4 Owner          (ordinary role, above the bot)
 */

import { namesToBitfield } from "../src/discord/permissions.js";
import type { APIRole } from "../src/discord/types.js";
import { FakeApi } from "./helpers.js";

export interface HierarchyFixture {
  api: FakeApi;
  guildId: string;
  roleIds: {
    everyone: string;
    booster: string;
    mod: string;
    bullhausAi: string;
    owner: string;
  };
}

export function buildHierarchyFixture(
  modPermissionNames: readonly string[] = [],
): HierarchyFixture {
  const api = new FakeApi();
  const guildId = api.guildId;

  const boosterId = "410000000000000001";
  const modId = "410000000000000002";
  const bullhausAiId = "410000000000000003";
  const ownerId = "410000000000000004";

  const everyone = api.roles[0] as APIRole;

  api.roles = [
    everyone,
    {
      id: boosterId,
      name: "Booster",
      color: 0,
      hoist: false,
      position: 1,
      permissions: "0",
      managed: true,
      mentionable: false,
    },
    {
      id: modId,
      name: "Mod",
      color: 0,
      hoist: false,
      position: 2,
      permissions: namesToBitfield(modPermissionNames),
      managed: false,
      mentionable: false,
    },
    {
      id: bullhausAiId,
      name: "BULLHAUS AI",
      color: 0,
      hoist: false,
      position: 3,
      permissions: namesToBitfield(["MANAGE_ROLES", "MANAGE_CHANNELS", "VIEW_CHANNEL"]),
      managed: true,
      mentionable: false,
    },
    {
      id: ownerId,
      name: "Owner",
      color: 0,
      hoist: false,
      position: 4,
      permissions: namesToBitfield(["ADMINISTRATOR"]),
      managed: false,
      mentionable: false,
    },
  ];

  api.members = [
    {
      user: {
        id: api.botUserId,
        username: "fake-bot",
        discriminator: "0",
        bot: true,
      },
      roles: [bullhausAiId],
      joined_at: new Date(0).toISOString(),
    },
  ];

  return {
    api,
    guildId,
    roleIds: { everyone: everyone.id, booster: boosterId, mod: modId, bullhausAi: bullhausAiId, owner: ownerId },
  };
}
