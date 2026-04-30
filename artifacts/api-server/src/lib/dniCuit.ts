/**
 * Validation for Argentine DNI / CUIT identifiers.
 *
 * Rules:
 *  - DNI: exactly 7 or 8 digits (no checksum).
 *  - CUIT: exactly 11 digits with mod-11 check digit (multipliers
 *    5,4,3,2,7,6,5,4,3,2; sum mod 11; if remainder=0 → 0,
 *    if remainder=1 → invalid, otherwise 11 - remainder).
 */

const CUIT_MULTIPLIERS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;

export function isValidCuit(value: string): boolean {
  if (!/^\d{11}$/u.test(value)) return false;
  const digits = value.split("").map((c) => Number(c));
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += digits[i]! * CUIT_MULTIPLIERS[i]!;
  }
  const remainder = sum % 11;
  let check: number;
  if (remainder === 0) check = 0;
  else if (remainder === 1) return false;
  else check = 11 - remainder;
  return check === digits[10];
}

/**
 * Returns true for a valid DNI (7-8 digits) or CUIT (11 digits w/ checksum).
 * Empty / undefined input is considered valid (the field is optional).
 */
export function isValidDniOrCuit(value: string | null | undefined): boolean {
  if (value == null) return true;
  const v = value.trim();
  if (v.length === 0) return true;
  if (/^\d{7,8}$/u.test(v)) return true;
  return isValidCuit(v);
}
