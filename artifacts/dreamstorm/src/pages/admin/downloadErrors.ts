// Helpers shared by the admin "Facturas" tab to turn a failed `fetch` into
// a user-facing toast message. Extracted from InvoicesTab.tsx so they can
// be unit-tested without spinning up the React tree (which pulls in toast,
// lucide icons, dialogs, etc.).

// Map HTTP error codes to user-friendly Spanish messages. We single out 401/403
// because those are the ones admins hit most often (Clerk session expired or
// they no longer have admin role) and the previous behaviour of opening a
// blank tab with raw JSON was confusing. For other failures (e.g. 404 when
// the order doesn't exist, 500 when PDF generation crashes) we prefer the
// server-provided message because it carries the *reason* — falling back to
// the generic "error N" only when the body wasn't parseable.
export function describeDownloadError(
  status: number,
  serverMessage?: string | null,
): string {
  if (status === 401) {
    return "Tu sesión expiró. Iniciá sesión nuevamente para descargar.";
  }
  if (status === 403) {
    return "No tenés permisos de administrador para descargar este archivo.";
  }
  if (serverMessage && serverMessage.trim()) {
    return serverMessage.trim();
  }
  return `No se pudo descargar el archivo (error ${status}).`;
}

// Attempt to extract a human-readable error message from a failed download
// response. The API consistently returns JSON of shape `{ error: string }`
// for 4xx/5xx responses, but we also accept the more conventional
// `{ message: string }` shape to stay robust against future changes. Any
// non-JSON or malformed body resolves to null so the caller can fall back to
// the generic status-based message.
export async function readErrorMessage(res: Response): Promise<string | null> {
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return null;
  }
  try {
    const data: unknown = await res.json();
    if (data && typeof data === "object") {
      const obj = data as Record<string, unknown>;
      const err = obj["error"];
      if (typeof err === "string" && err.trim()) return err;
      const msg = obj["message"];
      if (typeof msg === "string" && msg.trim()) return msg;
    }
    return null;
  } catch {
    return null;
  }
}
