// Authenticated download helpers used by the admin "Facturas" tab.
//
// These were extracted from InvoicesTab.tsx so they can be unit-tested
// without spinning up the React tree (which pulls in toast, lucide icons,
// dialogs, the Clerk session, etc.). The behaviour they encapsulate is
// load-bearing for admins: instead of `window.open(...)` (which used to
// surface 401/403 as a blank tab full of raw JSON), we now run an
// authenticated `fetch`, stream the success body into a Blob, and turn
// every failure into a Spanish toast in the original tab.

import { toast } from "sonner";
import { describeDownloadError, readErrorMessage } from "./downloadErrors";

const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

// Triggers a download of `blob` with the given filename without navigating
// away or opening a new tab. We create a transient <a> element, click it
// programmatically, then revoke the object URL to avoid leaking memory.
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revocation slightly so the browser has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Extracts a filename from a Content-Disposition header, falling back to the
// supplied default. Handles both `filename="…"` and unquoted forms.
export function parseFilename(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  return match?.[1] ?? fallback;
}

export async function downloadInvoicePdf(orderId: string): Promise<void> {
  // Authenticated fetch (Clerk session cookie is sent automatically). On
  // success we stream the response into a Blob and trigger a download in the
  // current tab. On failure we surface a toast — no new tab is opened so the
  // admin doesn't end up staring at a blank page with raw JSON.
  try {
    const res = await fetch(`${BASE}/api/orders/${orderId}/invoice-pdf`, {
      credentials: "include",
    });
    if (!res.ok) {
      const serverMessage = await readErrorMessage(res);
      toast.error(describeDownloadError(res.status, serverMessage));
      return;
    }
    const blob = await res.blob();
    const filename = parseFilename(
      res.headers.get("content-disposition"),
      `comprobante-${orderId}.pdf`,
    );
    triggerBlobDownload(blob, filename);
  } catch {
    toast.error("No se pudo descargar el comprobante. Revisá tu conexión.");
  }
}

export type PaymentMethodFilter =
  | "all"
  | "paypal"
  | "mercadopago"
  | "transferencia";

export async function downloadOrdersCsv(
  method: PaymentMethodFilter,
  from: string,
  to: string,
): Promise<void> {
  // Authenticated fetch instead of `window.open` so that 401/403 responses
  // can be surfaced as a toast in the original tab. The query string keeps
  // the server-side filter in sync with what the admin sees in the table —
  // the date range is applied server-side so the CSV exactly mirrors the
  // accounting period the admin asked for.
  const params = new URLSearchParams();
  if (method !== "all") params.set("paymentMethod", method);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  try {
    const res = await fetch(`${BASE}/api/orders/export${qs ? `?${qs}` : ""}`, {
      credentials: "include",
    });
    if (!res.ok) {
      const serverMessage = await readErrorMessage(res);
      toast.error(describeDownloadError(res.status, serverMessage));
      return;
    }
    const blob = await res.blob();
    const filename = parseFilename(
      res.headers.get("content-disposition"),
      "ordenes.csv",
    );
    triggerBlobDownload(blob, filename);
  } catch {
    toast.error("No se pudo descargar el CSV. Revisá tu conexión.");
  }
}
