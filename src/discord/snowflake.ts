/** Discord snowflake id: a decimal integer, 15-21 digits. */
export const SNOWFLAKE_RE = /^\d{15,21}$/;

export function isSnowflake(value: string): boolean {
  return SNOWFLAKE_RE.test(value);
}
