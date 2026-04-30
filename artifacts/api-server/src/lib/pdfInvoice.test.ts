/**
 * Unit tests for the `formatPaypalRateLine` helper used by both the PDF
 * receipt and the printable HTML receipt for PayPal orders.
 *
 * The helper centralizes the wording and formatting so both surfaces stay
 * in lockstep, and lets us assert the exact text without parsing PDFs.
 */

import { describe, expect, it } from "vitest";
import { formatPaypalRateLine } from "./pdfInvoice";

describe("formatPaypalRateLine", () => {
  it("renders the rate and USD equivalent for a PayPal order", () => {
    // 3000 ARS / 1234.5678 ARS-per-USD ≈ 2.43 USD
    const line = formatPaypalRateLine("paypal", "1234.5678", 3000);
    expect(line).toBe(
      "Tipo de cambio aplicado: 1 USD = $1.234,57 ARS (≈ USD 2,43)",
    );
  });

  it("formats integer-valued rates without trailing decimals issue", () => {
    // 2496 ARS / 1200 ARS-per-USD = 2.08 USD — matches the example in the
    // task description.
    const line = formatPaypalRateLine("paypal", "1200", 2496);
    expect(line).toBe(
      "Tipo de cambio aplicado: 1 USD = $1.200,00 ARS (≈ USD 2,08)",
    );
  });

  it.each([
    ["mercadopago", "1200"],
    ["transferencia", "1200"],
  ] as const)(
    "returns null for non-PayPal payment method %s",
    (method, rate) => {
      expect(formatPaypalRateLine(method, rate, 3000)).toBeNull();
    },
  );

  it.each([
    ["null rate (older orders)", null],
    ["empty string rate", ""],
    ["non-numeric rate", "abc"],
    ["zero rate (would divide by zero)", "0"],
    ["negative rate", "-1"],
  ] as const)("returns null for %s", (_label, rate) => {
    expect(formatPaypalRateLine("paypal", rate, 3000)).toBeNull();
  });

  it("returns null when rate is undefined", () => {
    expect(formatPaypalRateLine("paypal", undefined, 3000)).toBeNull();
  });
});
