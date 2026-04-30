/**
 * Tiny, framework-free helpers for the DNI/CUIT input on the checkout form.
 *
 * The checkout step decides — BEFORE making any network call — whether the
 * value the buyer typed is acceptable. The backend re-validates the same way
 * (with full CUIT checksum) but the frontend only needs to enforce the
 * length rule so we surface a friendly toast immediately instead of waiting
 * for a 400.
 *
 * Rules mirrored from `artifacts/api-server/src/lib/dniCuit.ts`:
 *   - empty / whitespace → accepted (the field is optional)
 *   - DNI: 7 or 8 digits
 *   - CUIT: 11 digits (the backend additionally verifies the check digit)
 */

export function dniDigits(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function isAcceptableDniInput(raw: string): boolean {
  const d = dniDigits(raw);
  if (d.length === 0) return true;
  return d.length === 7 || d.length === 8 || d.length === 11;
}

/**
 * Returns the value to send to the backend, or `undefined` if the field
 * should be omitted from the payload. Anything that isn't a valid length is
 * dropped (`isAcceptableDniInput` already gated the form, so callers should
 * have rejected those inputs before reaching this point).
 */
export function dniForPayload(raw: string): string | undefined {
  const d = dniDigits(raw);
  if (d.length === 7 || d.length === 8 || d.length === 11) return d;
  return undefined;
}
