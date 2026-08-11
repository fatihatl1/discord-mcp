import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  PERMISSION_NAMES,
  UnknownPermissionError,
  bitfieldToNames,
  namesToBitfield,
  parseBitfield,
} from "../src/discord/permissions.js";

describe("permission bitfields", () => {
  it("uses documented bit positions", () => {
    expect(PERMISSIONS.VIEW_CHANNEL).toBe(1n << 10n);
    expect(PERMISSIONS.SEND_MESSAGES).toBe(1n << 11n);
    expect(PERMISSIONS.MANAGE_ROLES).toBe(1n << 28n);
    expect(PERMISSIONS.MODERATE_MEMBERS).toBe(1n << 40n);
    expect(PERMISSIONS.BYPASS_SLOWMODE).toBe(1n << 52n);
  });

  it("round-trips names -> bitfield -> names", () => {
    const names = ["VIEW_CHANNEL", "SEND_MESSAGES", "MODERATE_MEMBERS"];
    const bitfield = namesToBitfield(names);
    expect(bitfield).toBe(
      ((1n << 10n) | (1n << 11n) | (1n << 40n)).toString(),
    );
    expect(bitfieldToNames(bitfield)).toEqual(names);
  });

  it("round-trips every documented permission at once", () => {
    const bitfield = namesToBitfield([...PERMISSION_NAMES]);
    expect(bitfieldToNames(bitfield)).toEqual([...PERMISSION_NAMES]);
  });

  it("serialises high bits as exact decimal strings (BigInt math)", () => {
    const bitfield = namesToBitfield(["ADMINISTRATOR", "BYPASS_SLOWMODE"]);
    expect(bitfield).toBe(((1n << 3n) | (1n << 52n)).toString());
    expect(bitfield).toBe("4503599627370504");
    // A hypothetical future bit above 2^53 must stay exact too.
    const future = ((1n << 60n) | (1n << 10n)).toString();
    expect(bitfieldToNames(future)).toEqual(["VIEW_CHANNEL", "UNKNOWN_BIT_60"]);
    expect(BigInt(future) > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it("throws a clear error listing valid names for unknown input", () => {
    expect(() => namesToBitfield(["VIEW_CHANNEL", "FLY_TO_MOON"])).toThrow(
      UnknownPermissionError,
    );
    try {
      namesToBitfield(["FLY_TO_MOON"]);
      expect.unreachable();
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain("FLY_TO_MOON");
      expect(message).toContain("VIEW_CHANNEL");
      expect(message).toContain("SEND_POLLS");
    }
  });

  it("reports unknown bits instead of dropping them", () => {
    const withUnknownBit = ((1n << 10n) | (1n << 47n)).toString();
    expect(bitfieldToNames(withUnknownBit)).toEqual([
      "VIEW_CHANNEL",
      "UNKNOWN_BIT_47",
    ]);
  });

  it("rejects non-decimal bitfield strings", () => {
    expect(() => parseBitfield("abc")).toThrow(/decimal string/);
    expect(() => bitfieldToNames("-5")).toThrow(/decimal string/);
  });

  it("decodes zero to an empty list", () => {
    expect(bitfieldToNames("0")).toEqual([]);
    expect(namesToBitfield([])).toBe("0");
  });
});
