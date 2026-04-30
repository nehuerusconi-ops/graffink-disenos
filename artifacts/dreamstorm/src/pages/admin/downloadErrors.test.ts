/**
 * Tests for the admin download error helpers.
 *
 * The Facturas tab kicks off downloads of CSVs and PDFs against admin-only
 * endpoints. When those fail, `readErrorMessage` parses the response body
 * for a server-supplied reason and `describeDownloadError` turns the status
 * + optional message into the toast text shown to the admin.
 *
 * These tests pin down two important behaviours so a future refactor can't
 * silently regress them:
 *  1. The 401/403 friendly Spanish messages always win, even if the server
 *     happens to send a less helpful body (e.g. "Unauthorized"). Admins
 *     hitting these codes need actionable advice ("Iniciá sesión") rather
 *     than the raw middleware string.
 *  2. For every other failure (most importantly 500 from PDF generation
 *     and 404 from a missing/unpaid order) we surface the server's `error`
 *     field verbatim, falling back to the generic message only when the
 *     body isn't parseable.
 */

import { describe, it, expect } from "vitest";
import { describeDownloadError, readErrorMessage } from "./downloadErrors";

function jsonResponse(body: unknown, status = 500): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

describe("describeDownloadError", () => {
  it("uses the friendly session message for 401 even when the server sends a body", () => {
    expect(describeDownloadError(401, "Unauthorized")).toBe(
      "Tu sesión expiró. Iniciá sesión nuevamente para descargar.",
    );
  });

  it("uses the friendly admin-role message for 403 even when the server sends a body", () => {
    expect(
      describeDownloadError(403, "Forbidden: se requiere rol de administrador"),
    ).toBe("No tenés permisos de administrador para descargar este archivo.");
  });

  it("prefers the server message for 500 errors", () => {
    expect(describeDownloadError(500, "No se pudo generar el comprobante")).toBe(
      "No se pudo generar el comprobante",
    );
  });

  it("prefers the server message for 404 errors", () => {
    expect(describeDownloadError(404, "Pedido no encontrado")).toBe(
      "Pedido no encontrado",
    );
  });

  it("falls back to a generic message when no server message is available", () => {
    expect(describeDownloadError(500)).toBe(
      "No se pudo descargar el archivo (error 500).",
    );
    expect(describeDownloadError(500, null)).toBe(
      "No se pudo descargar el archivo (error 500).",
    );
    expect(describeDownloadError(500, "   ")).toBe(
      "No se pudo descargar el archivo (error 500).",
    );
  });

  it("trims surrounding whitespace from the server message", () => {
    expect(describeDownloadError(500, "  Algo se rompió  ")).toBe(
      "Algo se rompió",
    );
  });
});

describe("readErrorMessage", () => {
  it("returns the `error` field from a JSON body", async () => {
    const res = jsonResponse({ error: "No se pudo generar el comprobante" });
    expect(await readErrorMessage(res)).toBe(
      "No se pudo generar el comprobante",
    );
  });

  it("returns the `message` field as a fallback shape", async () => {
    const res = jsonResponse({ message: "Algo se rompió" });
    expect(await readErrorMessage(res)).toBe("Algo se rompió");
  });

  it("prefers `error` over `message` when both are present", async () => {
    const res = jsonResponse({ error: "del servidor", message: "ignorame" });
    expect(await readErrorMessage(res)).toBe("del servidor");
  });

  it("returns null when the body is not JSON", async () => {
    const res = new Response("<html>boom</html>", {
      status: 500,
      headers: { "content-type": "text/html" },
    });
    expect(await readErrorMessage(res)).toBeNull();
  });

  it("returns null when the JSON body has no usable string field", async () => {
    expect(await readErrorMessage(jsonResponse({}))).toBeNull();
    expect(await readErrorMessage(jsonResponse({ error: 42 }))).toBeNull();
    expect(await readErrorMessage(jsonResponse({ error: "" }))).toBeNull();
    expect(await readErrorMessage(jsonResponse({ error: "   " }))).toBeNull();
  });

  it("returns null when the JSON body is malformed", async () => {
    const res = new Response("not json {", {
      status: 500,
      headers: { "content-type": "application/json" },
    });
    expect(await readErrorMessage(res)).toBeNull();
  });

  it("returns null for an empty body advertised as JSON", async () => {
    const res = new Response("", {
      status: 500,
      headers: { "content-type": "application/json" },
    });
    expect(await readErrorMessage(res)).toBeNull();
  });
});
