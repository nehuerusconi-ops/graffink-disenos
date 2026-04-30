import { describe, it, expect } from "vitest";
import { isValidCuit, isValidDniOrCuit } from "./dniCuit";

describe("isValidCuit", () => {
  it("accepts a valid CUIT with correct check digit", () => {
    // 20-12345678-3 — sum = 5*2 + 4*0 + 3*1 + 2*2 + 7*3 + 6*4 + 5*5 + 4*6 + 3*7 + 2*8
    //               = 10 + 0 + 3 + 4 + 21 + 24 + 25 + 24 + 21 + 16 = 148
    // 148 % 11 = 5; check = 11 - 5 = 6 → not 3
    // Use a real one: AFIP test CUIT 20-31345678-1
    // sum = 5*2+4*0+3*3+2*1+7*3+6*4+5*5+4*6+3*7+2*8
    //     = 10+0+9+2+21+24+25+24+21+16 = 152
    // 152 % 11 = 9; check = 11 - 9 = 2 → not 1
    // Let's compute one from scratch instead.
    const base = "2031345678"; // 10 digits
    const mults = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < 10; i += 1) sum += Number(base[i]) * mults[i]!;
    const remainder = sum % 11;
    const check = remainder === 0 ? 0 : remainder === 1 ? -1 : 11 - remainder;
    expect(check).toBeGreaterThanOrEqual(0);
    const cuit = base + String(check);
    expect(isValidCuit(cuit)).toBe(true);
  });

  it("rejects a CUIT with an incorrect check digit", () => {
    // Build a valid one then flip the last digit
    const base = "2031345678";
    const mults = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < 10; i += 1) sum += Number(base[i]) * mults[i]!;
    const remainder = sum % 11;
    const check = remainder === 0 ? 0 : remainder === 1 ? 9 : 11 - remainder;
    const wrong = base + String((check + 1) % 10);
    expect(isValidCuit(wrong)).toBe(false);
  });

  it("rejects strings that are not 11 digits", () => {
    expect(isValidCuit("")).toBe(false);
    expect(isValidCuit("1234567")).toBe(false);
    expect(isValidCuit("12345678")).toBe(false);
    expect(isValidCuit("123456789")).toBe(false);
    expect(isValidCuit("1234567890")).toBe(false);
    expect(isValidCuit("123456789012")).toBe(false);
  });

  it("rejects non-numeric input", () => {
    expect(isValidCuit("2031345678a")).toBe(false);
    expect(isValidCuit("20-31345678")).toBe(false);
  });
});

describe("isValidDniOrCuit", () => {
  it("treats null/undefined/empty as valid (optional field)", () => {
    expect(isValidDniOrCuit(null)).toBe(true);
    expect(isValidDniOrCuit(undefined)).toBe(true);
    expect(isValidDniOrCuit("")).toBe(true);
    expect(isValidDniOrCuit("   ")).toBe(true);
  });

  it("accepts DNI of 7 digits", () => {
    expect(isValidDniOrCuit("1234567")).toBe(true);
  });

  it("accepts DNI of 8 digits", () => {
    expect(isValidDniOrCuit("12345678")).toBe(true);
  });

  it("rejects 9 or 10 digit identifiers (not a DNI, not a CUIT)", () => {
    expect(isValidDniOrCuit("123456789")).toBe(false);
    expect(isValidDniOrCuit("1234567890")).toBe(false);
  });

  it("rejects identifiers shorter than 7 digits", () => {
    expect(isValidDniOrCuit("123456")).toBe(false);
    expect(isValidDniOrCuit("1")).toBe(false);
  });

  it("accepts a valid 11-digit CUIT (with checksum)", () => {
    const base = "2031345678";
    const mults = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < 10; i += 1) sum += Number(base[i]) * mults[i]!;
    const remainder = sum % 11;
    const check = remainder === 0 ? 0 : 11 - remainder;
    const cuit = base + String(check);
    expect(isValidDniOrCuit(cuit)).toBe(true);
  });

  it("rejects an 11-digit number with an invalid checksum", () => {
    expect(isValidDniOrCuit("12345678901")).toBe(false);
    expect(isValidDniOrCuit("00000000001")).toBe(false);
  });

  it("rejects strings containing non-digit characters", () => {
    expect(isValidDniOrCuit("12.345.678")).toBe(false);
    expect(isValidDniOrCuit("abcdefgh")).toBe(false);
    expect(isValidDniOrCuit("20-31345678-9")).toBe(false);
  });

  it("trims surrounding whitespace before validating", () => {
    expect(isValidDniOrCuit("  12345678  ")).toBe(true);
  });
});
