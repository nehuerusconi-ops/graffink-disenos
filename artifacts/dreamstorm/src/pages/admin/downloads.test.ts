/**
 * @vitest-environment happy-dom
 *
 * Tests for the admin authenticated download helpers.
 *
 * The Facturas tab used to start downloads with `window.open(...)`. When the
 * admin's Clerk session expired (401) or they no longer had the admin role
 * (403), that opened a blank tab containing the raw JSON error body — useless
 * to the admin and easy to miss. The current implementation runs an
 * authenticated `fetch` and surfaces failures as Spanish toasts in the
 * original tab. These tests pin that behaviour down so a future refactor
 * cannot silently regress to the previous "blank tab with JSON" UX.
 *
 * Each scenario asserts two things:
 *   - the expected toast was raised (and *only* that toast)
 *   - no `<a download>` was created (i.e. no actual file download was kicked
 *     off when the request failed)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { toast } from "sonner";
import {
  downloadInvoicePdf,
  downloadOrdersCsv,
  parseFilename,
} from "./downloads";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
  },
}));

// Captures every <a download> click that happens during a test. The download
// helper appends a transient anchor to <body>, calls click(), then removes it.
// We patch HTMLAnchorElement.prototype.click so we can assert on the filename
// and on the fact that the click happened at all (vs. nothing being clicked
// for the failure paths).
const anchorClicks: Array<{ download: string; href: string }> = [];

let createObjectURLSpy: ReturnType<typeof vi.spyOn>;
let revokeObjectURLSpy: ReturnType<typeof vi.spyOn>;
let originalClick: () => void;

beforeEach(() => {
  anchorClicks.length = 0;
  vi.mocked(toast.error).mockReset();
  vi.mocked(toast.warning).mockReset();
  vi.mocked(toast.success).mockReset();

  // happy-dom does not implement URL.createObjectURL / revokeObjectURL, so we
  // stub them to a noop URL string. The helper schedules revocation via
  // setTimeout(...,1000); we don't bother to fire timers because the
  // download trigger has already happened by the time our assertions run.
  createObjectURLSpy = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValue("blob:mock");
  revokeObjectURLSpy = vi
    .spyOn(URL, "revokeObjectURL")
    .mockImplementation(() => {});

  originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    anchorClicks.push({
      download: this.download,
      href: this.href,
    });
  };
});

afterEach(() => {
  HTMLAnchorElement.prototype.click = originalClick;
  createObjectURLSpy.mockRestore();
  revokeObjectURLSpy.mockRestore();
  vi.unstubAllGlobals();
});

function mockFetchOk(blob: Blob, contentDisposition?: string): void {
  const headers = new Headers();
  if (contentDisposition) {
    headers.set("content-disposition", contentDisposition);
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(blob, {
        status: 200,
        headers,
      }),
    ),
  );
}

function mockFetchStatus(
  status: number,
  body: unknown = { error: "fail" },
): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
}

function mockFetchNetworkError(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }),
  );
}

describe("parseFilename", () => {
  it("uses the fallback when there is no header", () => {
    expect(parseFilename(null, "fallback.pdf")).toBe("fallback.pdf");
  });

  it("extracts a quoted filename from Content-Disposition", () => {
    expect(
      parseFilename(
        'attachment; filename="comprobante-abc-123.pdf"',
        "fallback.pdf",
      ),
    ).toBe("comprobante-abc-123.pdf");
  });

  it("extracts an unquoted filename from Content-Disposition", () => {
    expect(
      parseFilename("attachment; filename=ordenes-2025.csv", "fallback.csv"),
    ).toBe("ordenes-2025.csv");
  });
});

describe("downloadInvoicePdf", () => {
  it("triggers a Blob download with the server-supplied filename on 200", async () => {
    const pdfBlob = new Blob(["%PDF-1.4 mock"], { type: "application/pdf" });
    mockFetchOk(
      pdfBlob,
      'attachment; filename="comprobante-abc-123.pdf"',
    );

    await downloadInvoicePdf("abc-123");

    // Exactly one <a download> click was triggered, with the filename pulled
    // from Content-Disposition rather than the orderId-based fallback.
    expect(anchorClicks).toHaveLength(1);
    expect(anchorClicks[0]?.download).toBe("comprobante-abc-123.pdf");
    expect(createObjectURLSpy).toHaveBeenCalledOnce();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("falls back to comprobante-<orderId>.pdf when the server omits Content-Disposition", async () => {
    mockFetchOk(new Blob(["%PDF-1.4"]));

    await downloadInvoicePdf("xyz-999");

    expect(anchorClicks).toHaveLength(1);
    expect(anchorClicks[0]?.download).toBe("comprobante-xyz-999.pdf");
  });

  it("shows the session-expired toast and does NOT download on 401", async () => {
    mockFetchStatus(401, { error: "Unauthorized" });

    await downloadInvoicePdf("abc-123");

    expect(toast.error).toHaveBeenCalledOnce();
    expect(toast.error).toHaveBeenCalledWith(
      "Tu sesión expiró. Iniciá sesión nuevamente para descargar.",
    );
    expect(anchorClicks).toHaveLength(0);
    expect(createObjectURLSpy).not.toHaveBeenCalled();
  });

  it("shows the no-permissions toast and does NOT download on 403", async () => {
    mockFetchStatus(403, { error: "Forbidden" });

    await downloadInvoicePdf("abc-123");

    expect(toast.error).toHaveBeenCalledOnce();
    expect(toast.error).toHaveBeenCalledWith(
      "No tenés permisos de administrador para descargar este archivo.",
    );
    expect(anchorClicks).toHaveLength(0);
  });

  it("surfaces the server message and does NOT download on 500", async () => {
    mockFetchStatus(500, { error: "No se pudo generar el comprobante" });

    await downloadInvoicePdf("abc-123");

    expect(toast.error).toHaveBeenCalledOnce();
    expect(toast.error).toHaveBeenCalledWith(
      "No se pudo generar el comprobante",
    );
    expect(anchorClicks).toHaveLength(0);
  });

  it("shows the connection toast on a network error", async () => {
    mockFetchNetworkError();

    await downloadInvoicePdf("abc-123");

    expect(toast.error).toHaveBeenCalledOnce();
    expect(toast.error).toHaveBeenCalledWith(
      "No se pudo descargar el comprobante. Revisá tu conexión.",
    );
    expect(anchorClicks).toHaveLength(0);
  });
});

describe("downloadOrdersCsv", () => {
  it("triggers a Blob download with the server-supplied filename on 200", async () => {
    const csvBlob = new Blob(["id,total\n1,100\n"], { type: "text/csv" });
    mockFetchOk(csvBlob, 'attachment; filename="ordenes-2025-04.csv"');

    await downloadOrdersCsv("mercadopago", "2025-04-01", "2025-04-30");

    expect(anchorClicks).toHaveLength(1);
    expect(anchorClicks[0]?.download).toBe("ordenes-2025-04.csv");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("falls back to ordenes.csv when the server omits Content-Disposition", async () => {
    mockFetchOk(new Blob(["id,total\n"]));

    await downloadOrdersCsv("all", "", "");

    expect(anchorClicks).toHaveLength(1);
    expect(anchorClicks[0]?.download).toBe("ordenes.csv");
  });

  it("includes payment-method and date filters in the request URL", async () => {
    const fetchSpy = vi.fn(
      async () => new Response(new Blob(["x"]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await downloadOrdersCsv("mercadopago", "2025-04-01", "2025-04-30");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const url = String(fetchSpy.mock.calls[0]?.[0]);
    expect(url).toContain("/api/orders/export");
    expect(url).toContain("paymentMethod=mercadopago");
    expect(url).toContain("from=2025-04-01");
    expect(url).toContain("to=2025-04-30");
  });

  it("omits the paymentMethod query param when the filter is 'all'", async () => {
    const fetchSpy = vi.fn(
      async () => new Response(new Blob(["x"]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await downloadOrdersCsv("all", "", "");

    const url = String(fetchSpy.mock.calls[0]?.[0]);
    expect(url).not.toContain("paymentMethod=");
    expect(url).not.toContain("from=");
    expect(url).not.toContain("to=");
  });

  it("shows the session-expired toast and does NOT download on 401", async () => {
    mockFetchStatus(401, { error: "Unauthorized" });

    await downloadOrdersCsv("all", "", "");

    expect(toast.error).toHaveBeenCalledOnce();
    expect(toast.error).toHaveBeenCalledWith(
      "Tu sesión expiró. Iniciá sesión nuevamente para descargar.",
    );
    expect(anchorClicks).toHaveLength(0);
    expect(createObjectURLSpy).not.toHaveBeenCalled();
  });

  it("shows the no-permissions toast and does NOT download on 403", async () => {
    mockFetchStatus(403, { error: "Forbidden" });

    await downloadOrdersCsv("all", "", "");

    expect(toast.error).toHaveBeenCalledOnce();
    expect(toast.error).toHaveBeenCalledWith(
      "No tenés permisos de administrador para descargar este archivo.",
    );
    expect(anchorClicks).toHaveLength(0);
  });

  it("surfaces the server message and does NOT download on 500", async () => {
    mockFetchStatus(500, { error: "Falló la exportación" });

    await downloadOrdersCsv("all", "", "");

    expect(toast.error).toHaveBeenCalledOnce();
    expect(toast.error).toHaveBeenCalledWith("Falló la exportación");
    expect(anchorClicks).toHaveLength(0);
  });

  it("shows the connection toast on a network error", async () => {
    mockFetchNetworkError();

    await downloadOrdersCsv("all", "", "");

    expect(toast.error).toHaveBeenCalledOnce();
    expect(toast.error).toHaveBeenCalledWith(
      "No se pudo descargar el CSV. Revisá tu conexión.",
    );
    expect(anchorClicks).toHaveLength(0);
  });
});
