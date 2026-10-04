/**
 * Shared hierarchy / self-role safety checks for the role mutation tools
 * (edit_role, edit_role_permissions, edit_role_position). Discord itself
 * enforces role hierarchy server-side, but checking it here lets a mutation
 * fail with a precise, structured reason instead of an opaque 403 -- and
 * means a dry-run preview can show the real outcome instead of a happy path
 * that would never actually apply.
 */

import type { DiscordApi } from "../discord/endpoints.js";
import type { APIRole } from "../discord/types.js";
import { ToolSafetyError } from "./shared.js";

export interface BotHierarchyInfo {
  botUserId: string;
  /** Role ids the bot currently holds (never includes @everyone). */
  botRoleIds: readonly string[];
  /** Of those, the ones Discord marks as integration-managed. */
  botManagedRoleIds: readonly string[];
  /** The highest position among the bot's held roles; 0 if it holds none. */
  highestPosition: number;
}

export async function loadBotHierarchyInfo(
  api: DiscordApi,
  guildId: string,
  roles: readonly APIRole[],
): Promise<BotHierarchyInfo> {
  const me = await api.getCurrentUser();
  const member = await api.getGuildMember(guildId, me.id);
  const roleById = new Map(roles.map((r) => [r.id, r] as const));

  let highestPosition = 0;
  const managedRoleIds: string[] = [];
  for (const roleId of member.roles) {
    const role = roleById.get(roleId);
    if (!role) continue;
    if (role.position > highestPosition) highestPosition = role.position;
    if (role.managed) managedRoleIds.push(role.id);
  }

  return {
    botUserId: me.id,
    botRoleIds: member.roles,
    botManagedRoleIds: managedRoleIds,
    highestPosition,
  };
}

/**
 * Throws SELF_ROLE_EDIT_BLOCKED or ROLE_HIERARCHY_BLOCKED when `target`
 * cannot be mutated by the bot; returns normally when the mutation is
 * allowed to proceed (Discord may still reject it for other reasons, e.g. a
 * managed-role restriction -- see DISCORD_REJECTED_MANAGED_ROLE_EDIT).
 */
export function assertRoleMutationAllowed(
  hierarchy: BotHierarchyInfo,
  target: APIRole,
): void {
  if (hierarchy.botManagedRoleIds.includes(target.id)) {
    throw new ToolSafetyError(
      "SELF_ROLE_EDIT_BLOCKED",
      `Role ${target.id} ("${target.name}") is BULLHAUS AI's own managed ` +
        "integration role. Editing a bot's own managed role is an " +
        "intentional Discord safety boundary; this tool will not attempt " +
        "to work around it.",
      { guild_role_id: target.id, role_name: target.name },
    );
  }
  if (target.position >= hierarchy.highestPosition) {
    throw new ToolSafetyError(
      "ROLE_HIERARCHY_BLOCKED",
      `Role ${target.id} ("${target.name}", position ${target.position}) is ` +
        "at or above BULLHAUS AI's highest role (position " +
        `${hierarchy.highestPosition}). Discord only allows a bot to manage ` +
        "roles strictly below its own highest role; raise the bot's role " +
        "in Server Settings -> Roles if this mutation is actually intended.",
      {
        role_position: target.position,
        bot_highest_position: hierarchy.highestPosition,
      },
    );
  }
}

export async function loadRoleAndHierarchy(
  api: DiscordApi,
  guildId: string,
  roleId: string,
): Promise<{ roles: APIRole[]; role: APIRole; hierarchy: BotHierarchyInfo }> {
  const roles = await api.listGuildRoles(guildId);
  const role = roles.find((r) => r.id === roleId);
  if (!role) {
    throw new ToolSafetyError(
      "ROLE_NOT_FOUND",
      `No role with id ${roleId} exists in guild ${guildId}.`,
      { guild_id: guildId, role_id: roleId },
    );
  }
  const hierarchy = await loadBotHierarchyInfo(api, guildId, roles);
  return { roles, role, hierarchy };
}
