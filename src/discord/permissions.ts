/**
 * Discord permission bitfield constants and helpers.
 *
 * Discord serialises permission bitfields as decimal strings because the
 * values exceed 2^53. All arithmetic here uses BigInt; Number is never used
 * for bit math.
 *
 * Bit positions verified against the official documentation
 * (https://docs.discord.com/developers/topics/permissions, fetched 2026-08-09).
 * Bit 47 is unassigned in the public docs and is deliberately absent.
 */

export const PERMISSIONS = Object.freeze({
  CREATE_INSTANT_INVITE: 1n << 0n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 7n,
  PRIORITY_SPEAKER: 1n << 8n,
  STREAM: 1n << 9n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  SEND_TTS_MESSAGES: 1n << 12n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  USE_EXTERNAL_EMOJIS: 1n << 18n,
  VIEW_GUILD_INSIGHTS: 1n << 19n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  MUTE_MEMBERS: 1n << 22n,
  DEAFEN_MEMBERS: 1n << 23n,
  MOVE_MEMBERS: 1n << 24n,
  USE_VAD: 1n << 25n,
  CHANGE_NICKNAME: 1n << 26n,
  MANAGE_NICKNAMES: 1n << 27n,
  MANAGE_ROLES: 1n << 28n,
  MANAGE_WEBHOOKS: 1n << 29n,
  MANAGE_GUILD_EXPRESSIONS: 1n << 30n,
  USE_APPLICATION_COMMANDS: 1n << 31n,
  REQUEST_TO_SPEAK: 1n << 32n,
  MANAGE_EVENTS: 1n << 33n,
  MANAGE_THREADS: 1n << 34n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  CREATE_PRIVATE_THREADS: 1n << 36n,
  USE_EXTERNAL_STICKERS: 1n << 37n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  USE_EMBEDDED_ACTIVITIES: 1n << 39n,
  MODERATE_MEMBERS: 1n << 40n,
  VIEW_CREATOR_MONETIZATION_ANALYTICS: 1n << 41n,
  USE_SOUNDBOARD: 1n << 42n,
  CREATE_GUILD_EXPRESSIONS: 1n << 43n,
  CREATE_EVENTS: 1n << 44n,
  USE_EXTERNAL_SOUNDS: 1n << 45n,
  SEND_VOICE_MESSAGES: 1n << 46n,
  SET_VOICE_CHANNEL_STATUS: 1n << 48n,
  SEND_POLLS: 1n << 49n,
  USE_EXTERNAL_APPS: 1n << 50n,
  PIN_MESSAGES: 1n << 51n,
  BYPASS_SLOWMODE: 1n << 52n,
} satisfies Record<string, bigint>);

export type PermissionName = keyof typeof PERMISSIONS;

/** Union of every documented permission bit -- what ADMINISTRATOR resolves to. */
export const ALL_PERMISSIONS_BITS: bigint = Object.values(PERMISSIONS).reduce(
  (acc, bit) => acc | bit,
  0n,
);

/** All valid permission names, ordered by bit position. */
export const PERMISSION_NAMES: readonly PermissionName[] = Object.freeze(
  (Object.keys(PERMISSIONS) as PermissionName[]).sort((a, b) =>
    PERMISSIONS[a] < PERMISSIONS[b] ? -1 : 1,
  ),
);

export function isPermissionName(name: string): name is PermissionName {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, name);
}

export class UnknownPermissionError extends Error {
  readonly unknownNames: readonly string[];

  constructor(unknownNames: readonly string[]) {
    super(
      `Unknown permission name(s): ${unknownNames.join(", ")}. ` +
        `Valid names are: ${PERMISSION_NAMES.join(", ")}`,
    );
    this.name = "UnknownPermissionError";
    this.unknownNames = unknownNames;
  }
}

/**
 * Combine permission names into a Discord bitfield string.
 * Throws UnknownPermissionError (listing every valid name) on any unknown
 * input so tool callers get an actionable message, not a silent zero.
 */
export function namesToBitfield(names: readonly string[]): string {
  return namesToBits(names).toString();
}

/** Same as namesToBitfield but returns the BigInt for internal bit math. */
export function namesToBits(names: readonly string[]): bigint {
  const unknown = names.filter((n) => !isPermissionName(n));
  if (unknown.length > 0) {
    throw new UnknownPermissionError(unknown);
  }
  let bits = 0n;
  for (const name of names) {
    bits |= PERMISSIONS[name as PermissionName];
  }
  return bits;
}

/**
 * Decode a Discord bitfield string into permission names, ordered by bit
 * position. Bits that do not correspond to a documented permission are
 * reported as UNKNOWN_BIT_<n> rather than dropped.
 */
export function bitfieldToNames(bitfield: string): string[] {
  const bits = parseBitfield(bitfield);
  const names: string[] = [];
  let covered = 0n;
  for (const name of PERMISSION_NAMES) {
    const bit = PERMISSIONS[name];
    if ((bits & bit) === bit) {
      names.push(name);
      covered |= bit;
    }
  }
  let leftover = bits & ~covered;
  for (let pos = 0n; leftover > 0n; pos++) {
    const bit = 1n << pos;
    if ((leftover & bit) === bit) {
      names.push(`UNKNOWN_BIT_${pos}`);
      leftover &= ~bit;
    }
  }
  return names;
}

export function parseBitfield(bitfield: string): bigint {
  if (!/^\d+$/.test(bitfield)) {
    throw new Error(
      `Invalid permission bitfield "${bitfield}": expected a decimal string`,
    );
  }
  return BigInt(bitfield);
}

export function hasPermission(bitfield: string, name: PermissionName): boolean {
  const bit = PERMISSIONS[name];
  return (parseBitfield(bitfield) & bit) === bit;
}
