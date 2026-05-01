import { useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { useListOrders } from "@workspace/api-client-react";
import type { Order } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  FileText,
  Printer,
  Search,
  Eye,
  Download,
  FileSpreadsheet,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  downloadInvoicePdf,
  downloadOrdersCsv,
  type PaymentMethodFilter,
} from "./downloads";
import {
  loadPersistedDateRange,
  persistDateRange,
  type DateRange,
} from "./invoicesDateRangeStorage";

const PAYMENT_LABELS: Record<string, string> = {
  mercadopago: "Mercado Pago",
  transferencia: "Transferencia bancaria",
  paypal: "PayPal",
};

const CONFIRMATION_SOURCE_LABELS: Record<string, string> = {
  webhook: "Webhook automático",
  manual: "Intervención manual",
  "paypal-capture": "Captura PayPal",
};

const CONFIRMATION_SOURCE_COLORS: Record<string, string> = {
  webhook: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  manual: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  "paypal-capture": "bg-purple-500/10 text-purple-400 border-purple-500/20",
};

const STATUS_LABELS: Record<string, string> = {
  paid: "Pagada",
  pending: "Pendiente",
  failed: "Fallida",
  refunded: "Reembolsada",
};

const STATUS_COLORS: Record<string, string> = {
  paid: "bg-green-500/10 text-green-400 border-green-500/20",
  pending: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  failed: "bg-red-500/10 text-red-400 border-red-500/20",
  refunded: "bg-white/10 text-white/60 border-white/20",
};

function formatARS(value: number): string {
  return `$${value.toLocaleString("es-AR")}`;
}

function formatDate(d: string): string {
  return new Date(d).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatInvoiceNumber(n: number): string {
  return String(n).padStart(6, "0");
}

function printInvoice(order: Order) {
  const win = window.open("", "_blank", "width=800,height=900");
  if (!win) return;
  const itemsRows = order.items
    .map(
      (it) => `
      <tr>
        <td>${escapeHtml(it.name)}</td>
        <td style="text-align:center">${it.quantity}</td>
        <td style="text-align:right">$${it.price.toLocaleString("es-AR")}</td>
        <td style="text-align:right">$${(it.price * it.quantity).toLocaleString("es-AR")}</td>
      </tr>
    `,
    )
    .join("");

  // Exchange rate audit line: only rendered for PayPal orders that have a
  // persisted arsToUsdRate (older orders silently omit it).
  let exchangeRateBlock = "";
  if (order.paymentMethod === "paypal" && order.arsToUsdRate) {
    const rateNum = parseFloat(order.arsToUsdRate);
    if (Number.isFinite(rateNum) && rateNum > 0) {
      const usdEquivalent = order.total / rateNum;
      exchangeRateBlock = `
        <div class="line">
          <span>Tipo de cambio aplicado</span>
          <span>1 USD = $${rateNum.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ARS (≈ USD ${usdEquivalent.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</span>
        </div>
      `;
    }
  }

  win.document.write(`
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <title>Factura ${formatInvoiceNumber(order.invoiceNumber)}</title>
        <style>
          * { box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: #111;
            background: #fff;
            margin: 0;
            padding: 40px;
          }
          .head {
            display: flex; justify-content: space-between; align-items: flex-start;
            border-bottom: 3px solid #111; padding-bottom: 24px; margin-bottom: 32px;
          }
          .brand { font-size: 32px; font-weight: 900; letter-spacing: -1px; text-transform: uppercase; }
          .brand small { display:block; font-size:11px; font-weight:600; letter-spacing:3px; color:#666; margin-top:4px; }
          .meta { text-align: right; font-size: 13px; line-height: 1.6; }
          .meta strong { font-size: 18px; }
          h2 { font-size: 11px; letter-spacing: 2px; color: #666; text-transform: uppercase; margin: 0 0 8px; }
          .row { display: flex; gap: 40px; margin-bottom: 32px; }
          .row > div { flex: 1; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
          th { text-align: left; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: #666; border-bottom: 1px solid #ddd; padding: 12px 8px; }
          th:nth-child(2) { text-align: center; }
          th:nth-child(3), th:nth-child(4) { text-align: right; }
          td { padding: 16px 8px; border-bottom: 1px solid #f0f0f0; font-size: 14px; }
          .totals { margin-left: auto; width: 280px; font-size: 14px; }
          .totals .line { display:flex; justify-content:space-between; padding: 8px 0; }
          .totals .grand { border-top: 2px solid #111; margin-top: 8px; padding-top: 16px; font-size: 20px; font-weight: 900; }
          .footer { margin-top: 48px; font-size: 11px; color: #888; text-align: center; border-top: 1px solid #eee; padding-top: 16px; }
          @media print { body { padding: 24px; } .no-print { display: none; } }
          .actions { position: fixed; top: 16px; right: 16px; }
          .actions button { background: #111; color: #fff; border: 0; padding: 10px 16px; border-radius: 4px; font-weight: 700; cursor: pointer; }
        </style>
      </head>
      <body>
        <div class="actions no-print">
          <button onclick="window.print()">Imprimir / Guardar PDF</button>
        </div>
        <div class="head">
          <div class="brand">GraffInk Diseños<small>Diseños DTF</small></div>
          <div class="meta">
            <strong>Factura N° ${formatInvoiceNumber(order.invoiceNumber)}</strong><br/>
            ${formatDate(order.createdAt)}<br/>
            ID: ${order.id}
          </div>
        </div>
        <div class="row">
          <div>
            <h2>Facturado a</h2>
            <div style="font-weight:700;font-size:15px">${escapeHtml(order.customerName)}</div>
            <div style="color:#666">${escapeHtml(order.customerEmail)}</div>
            <div style="color:#666">DNI / CUIT: ${order.customerDni ? escapeHtml(order.customerDni) : "—"}</div>
          </div>
          <div>
            <h2>Forma de pago</h2>
            <div style="font-weight:700;font-size:15px">${PAYMENT_LABELS[order.paymentMethod] ?? order.paymentMethod}</div>
            <div style="color:#666">Estado: ${STATUS_LABELS[order.status] ?? order.status}</div>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Diseño</th>
              <th>Cant.</th>
              <th>Precio</th>
              <th>Subtotal</th>
            </tr>
          </thead>
          <tbody>${itemsRows}</tbody>
        </table>
        <div class="totals">
          <div class="line"><span>Subtotal</span><span>$${order.total.toLocaleString("es-AR")}</span></div>
          <div class="line grand"><span>TOTAL</span><span>$${order.total.toLocaleString("es-AR")} ARS</span></div>
          ${exchangeRateBlock}
        </div>
        <div class="footer">
          Gracias por tu compra · GraffInk Diseños · Archivos digitales DTF de alta calidad
        </div>
      </body>
    </html>
  `);
  win.document.close();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Format a Date as YYYY-MM-DD in *local* time. The native <input type="date">
// uses this exact format and interprets it in the user's timezone, so we
// build the string from local components instead of `toISOString()` (which
// would shift the day for admins east/west of UTC).
function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Convert a YYYY-MM-DD value (as produced by <input type="date">) into the
// DD/MM/YYYY format Argentine admins expect when read in plain Spanish prose.
// We split the string ourselves to avoid timezone shifts that would happen
// with `new Date(yyyymmdd)` near midnight UTC.
function displayLocalDate(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split("-");
  if (!y || !m || !d) return yyyymmdd;
  return `${d}/${m}/${y}`;
}

// Build a Spanish phrase describing the active date range, used both in the
// empty-state message and the "nothing to export" toast. Handles the three
// shapes the admin can produce: only "desde", only "hasta", or both.
function describeDateRange(from: string, to: string): string {
  if (from && to) {
    return `entre ${displayLocalDate(from)} y ${displayLocalDate(to)}`;
  }
  if (from) return `desde ${displayLocalDate(from)}`;
  if (to) return `hasta ${displayLocalDate(to)}`;
  return "";
}

// Quick preset ranges for the most common accounting periods. Computed lazily
// (inside the component on every render) so they always reflect "now" — e.g.
// "Hoy" updates if the admin keeps the tab open across midnight. Weeks start
// on Monday, matching the Argentine convention for business reporting.
function computePreset(kind: PresetKind, now: Date = new Date()): DateRange {
  switch (kind) {
    case "today": {
      const t = formatLocalDate(now);
      return { from: t, to: t };
    }
    case "yesterday": {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      const s = formatLocalDate(d);
      return { from: s, to: s };
    }
    case "thisWeek": {
      const day = now.getDay(); // 0 = Sunday, 1 = Monday, …, 6 = Saturday
      const offsetToMonday = day === 0 ? 6 : day - 1;
      const monday = new Date(now);
      monday.setDate(now.getDate() - offsetToMonday);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return { from: formatLocalDate(monday), to: formatLocalDate(sunday) };
    }
    case "thisMonth": {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { from: formatLocalDate(first), to: formatLocalDate(last) };
    }
    case "lastMonth": {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: formatLocalDate(first), to: formatLocalDate(last) };
    }
    case "thisQuarter": {
      const q = Math.floor(now.getMonth() / 3);
      const first = new Date(now.getFullYear(), q * 3, 1);
      const last = new Date(now.getFullYear(), q * 3 + 3, 0);
      return { from: formatLocalDate(first), to: formatLocalDate(last) };
    }
    case "thisYear": {
      const y = now.getFullYear();
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
  }
}

type PresetKind =
  | "today"
  | "yesterday"
  | "thisWeek"
  | "thisMonth"
  | "lastMonth"
  | "thisQuarter"
  | "thisYear";

const DATE_PRESETS: ReadonlyArray<{ kind: PresetKind; label: string }> = [
  { kind: "today", label: "Hoy" },
  { kind: "yesterday", label: "Ayer" },
  { kind: "thisWeek", label: "Esta semana" },
  { kind: "thisMonth", label: "Este mes" },
  { kind: "lastMonth", label: "Mes pasado" },
  { kind: "thisQuarter", label: "Este trimestre" },
  { kind: "thisYear", label: "Este año" },
];

export function InvoicesTab() {
  const { data: orders, isLoading } = useListOrders<Order[]>();
  const [search, setSearch] = useState("");
  const [methodFilter, setMethodFilter] = useState<PaymentMethodFilter>("all");
  // Date range for the CSV export. Both fields are optional — the admin can
  // leave either one blank to mean "open ended". The same range is also
  // applied client-side to the table so what the admin sees matches what
  // the CSV will contain.
  //
  // The initial value is hydrated from `localStorage` so the admin doesn't
  // have to re-pick a preset every time they open the tab. We read storage
  // exactly once (lazy initializer) so changes from other tabs while this
  // one is open don't yank the inputs out from under the admin.
  const [fromDate, setFromDate] = useState<string>(
    () => loadPersistedDateRange().from,
  );
  const [toDate, setToDate] = useState<string>(
    () => loadPersistedDateRange().to,
  );
  // Mirror every change back to storage. An empty range is a meaningful
  // signal — if the admin clicks "Limpiar fechas" we want them to reopen
  // the tab on empty, not on a stale preset — so we persist `{from:"",
  // to:""}` rather than removing the key.
  useEffect(() => {
    persistDateRange({ from: fromDate, to: toDate });
  }, [fromDate, toDate]);
  const rangeInvalid = Boolean(fromDate && toDate && fromDate > toDate);
  const [selected, setSelected] = useState<Order | null>(null);

  const filtered = useMemo(() => {
    if (!orders) return [];
    const q = search.trim().toLowerCase();
    // Match the server: dates snap to UTC day boundaries so the local table
    // preview lines up exactly with what the export endpoint will return.
    const fromMs = fromDate ? Date.parse(`${fromDate}T00:00:00.000Z`) : null;
    const toMs = toDate ? Date.parse(`${toDate}T23:59:59.999Z`) : null;
    return orders.filter((o) => {
      if (methodFilter !== "all" && o.paymentMethod !== methodFilter) {
        return false;
      }
      if (fromMs !== null || toMs !== null) {
        const created = Date.parse(o.createdAt);
        if (fromMs !== null && created < fromMs) return false;
        if (toMs !== null && created > toMs) return false;
      }
      if (!q) return true;
      return (
        o.customerName.toLowerCase().includes(q) ||
        o.customerEmail.toLowerCase().includes(q) ||
        formatInvoiceNumber(o.invoiceNumber).includes(q) ||
        o.id.includes(q)
      );
    });
  }, [orders, search, methodFilter, fromDate, toDate]);

  // Count how many orders the export endpoint would return for the current
  // payment-method + date-range filters. The CSV export ignores the search
  // box (it's a client-only filter), so we mirror exactly the server-side
  // criteria here. Used to short-circuit the download when it would yield an
  // empty CSV — instead we surface a toast so the admin knows nothing was
  // missed and the silent header-only download is avoided.
  const exportCount = useMemo(() => {
    if (!orders) return 0;
    const fromMs = fromDate ? Date.parse(`${fromDate}T00:00:00.000Z`) : null;
    const toMs = toDate ? Date.parse(`${toDate}T23:59:59.999Z`) : null;
    return orders.filter((o) => {
      if (methodFilter !== "all" && o.paymentMethod !== methodFilter) {
        return false;
      }
      if (fromMs !== null || toMs !== null) {
        const created = Date.parse(o.createdAt);
        if (fromMs !== null && created < fromMs) return false;
        if (toMs !== null && created > toMs) return false;
      }
      return true;
    }).length;
  }, [orders, methodFilter, fromDate, toDate]);

  function handleExportClick(): void {
    if (rangeInvalid) return;
    if (exportCount === 0) {
      const rangePhrase = describeDateRange(fromDate, toDate);
      const msg = rangePhrase
        ? `No hay ventas ${rangePhrase}. No se descargó ningún archivo.`
        : "No hay ventas con los filtros actuales. No se descargó ningún archivo.";
      toast.warning(msg);
      return;
    }
    void downloadOrdersCsv(methodFilter, fromDate, toDate);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-white/50" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-bold uppercase tracking-wider">
            Facturas{" "}
            <span className="text-white/40">
              ({filtered.length}
              {orders && filtered.length !== orders.length
                ? ` de ${orders.length}`
                : ""}
              )
            </span>
          </h2>
          <p className="text-sm text-white/50">
            Listado completo de ventas con factura imprimible.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 w-full lg:w-auto lg:items-end">
          <Select
            value={methodFilter}
            onValueChange={(v) => setMethodFilter(v as PaymentMethodFilter)}
          >
            <SelectTrigger
              className="w-full sm:w-44"
              aria-label="Filtrar por método de pago"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los métodos</SelectItem>
              <SelectItem value="paypal">PayPal</SelectItem>
              <SelectItem value="mercadopago">Mercado Pago</SelectItem>
              <SelectItem value="transferencia">Transferencia bancaria</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex flex-col w-full sm:w-auto">
            <label
              htmlFor="invoices-from-date"
              className="text-[10px] uppercase tracking-widest text-white/40 mb-1"
            >
              Desde
            </label>
            <Input
              id="invoices-from-date"
              type="date"
              value={fromDate}
              max={toDate || undefined}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full sm:w-40"
              aria-label="Fecha desde"
            />
          </div>
          <div className="flex flex-col w-full sm:w-auto">
            <label
              htmlFor="invoices-to-date"
              className="text-[10px] uppercase tracking-widest text-white/40 mb-1"
            >
              Hasta
            </label>
            <Input
              id="invoices-to-date"
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full sm:w-40"
              aria-label="Fecha hasta"
            />
          </div>
          {(fromDate || toDate) && (
            <Button
              variant="ghost"
              onClick={() => {
                setFromDate("");
                setToDate("");
              }}
              className="text-white/60 hover:text-white whitespace-nowrap"
              title="Limpiar rango de fechas"
            >
              Limpiar fechas
            </Button>
          )}
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por cliente, email o N°"
              className="pl-9"
            />
          </div>
          <Button
            variant="outline"
            onClick={handleExportClick}
            disabled={rangeInvalid}
            className="border-white/10 hover:bg-white/5 whitespace-nowrap"
            title={
              rangeInvalid
                ? "El rango de fechas es inválido (desde > hasta)"
                : exportCount === 0
                  ? "No hay órdenes para exportar con los filtros actuales"
                  : `Descargar CSV con ${exportCount} orden${exportCount === 1 ? "" : "es"}`
            }
          >
            <FileSpreadsheet className="h-4 w-4 mr-2" /> Exportar CSV
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-white/40 mr-1">
          Rangos rápidos
        </span>
        {DATE_PRESETS.map(({ kind, label }) => {
          const range = computePreset(kind);
          // Highlight the preset whose computed range matches the inputs so
          // the admin can see at a glance which atajo is currently active.
          const active = fromDate === range.from && toDate === range.to;
          return (
            <Button
              key={kind}
              size="sm"
              variant={active ? "default" : "outline"}
              onClick={() => {
                setFromDate(range.from);
                setToDate(range.to);
              }}
              className={
                active
                  ? "h-7 px-3 text-xs whitespace-nowrap"
                  : "h-7 px-3 text-xs whitespace-nowrap border-white/10 hover:bg-white/5"
              }
              title={`${range.from} → ${range.to}`}
            >
              {label}
            </Button>
          );
        })}
      </div>
      {rangeInvalid && (
        <p className="text-xs text-red-400">
          El rango de fechas es inválido: la fecha "desde" es posterior a "hasta".
        </p>
      )}

      {filtered.length === 0 ? (
        <div className="text-center py-24 border border-dashed border-white/10 rounded-sm">
          <FileText className="h-10 w-10 text-white/20 mx-auto mb-3" />
          <p className="text-white/50">
            {orders && orders.length > 0
              ? // When the active date range itself is empty (no orders inside
                // it regardless of search/method), tell the admin explicitly so
                // they can distinguish "filter is wrong" from "no sales that
                // week" — previously they only saw the generic message.
                (fromDate || toDate) && exportCount === 0
                ? `No hay ventas ${describeDateRange(fromDate, toDate)}.`
                : "No hay resultados para esa búsqueda."
              : "Todavía no hay ventas registradas."}
          </p>
        </div>
      ) : (
        <div className="bg-card border border-card-border rounded-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-widest text-white/40 border-b border-white/5">
                  <th className="px-4 py-3 font-bold">N° Factura</th>
                  <th className="px-4 py-3 font-bold">Fecha</th>
                  <th className="px-4 py-3 font-bold">Cliente</th>
                  <th className="px-4 py-3 font-bold">Método</th>
                  <th className="px-4 py-3 font-bold">Origen</th>
                  <th className="px-4 py-3 font-bold">Estado</th>
                  <th className="px-4 py-3 font-bold text-right">Total</th>
                  <th className="px-4 py-3 font-bold text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => (
                  <tr
                    key={o.id}
                    className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]"
                  >
                    <td className="px-4 py-3 font-mono font-bold text-primary">
                      #{formatInvoiceNumber(o.invoiceNumber)}
                    </td>
                    <td className="px-4 py-3 text-white/70 whitespace-nowrap">
                      {formatDate(o.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{o.customerName}</div>
                      <div className="text-xs text-white/50">{o.customerEmail}</div>
                    </td>
                    <td className="px-4 py-3 text-white/70">
                      {PAYMENT_LABELS[o.paymentMethod] ?? o.paymentMethod}
                    </td>
                    <td className="px-4 py-3">
                      {o.confirmationSource ? (
                        <span
                          className={`inline-block text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-sm border ${CONFIRMATION_SOURCE_COLORS[o.confirmationSource] ?? "bg-white/5 text-white/40 border-white/10"}`}
                        >
                          {CONFIRMATION_SOURCE_LABELS[o.confirmationSource] ?? o.confirmationSource}
                        </span>
                      ) : (
                        <span className="text-white/20 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-sm border ${STATUS_COLORS[o.status] ?? ""}`}
                      >
                        {STATUS_LABELS[o.status] ?? o.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold">
                      {formatARS(o.total)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelected(o)}
                          title="Ver detalle"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => printInvoice(o)}
                          title="Imprimir factura"
                        >
                          <Printer className="h-4 w-4" />
                        </Button>
                        {o.status === "paid" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => downloadInvoicePdf(o.id)}
                            title="Descargar comprobante PDF"
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="sm:max-w-lg bg-background border-white/10">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl font-black uppercase tracking-tight">
                  Factura N° {formatInvoiceNumber(selected.invoiceNumber)}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-3 text-white/70">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-white/40">Cliente</p>
                    <p className="text-white font-medium">{selected.customerName}</p>
                    <p className="text-xs">{selected.customerEmail}</p>
                    {selected.customerDni && (
                      <p className="text-xs text-white/50 font-mono">DNI/CUIT: {selected.customerDni}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-white/40">Fecha</p>
                    <p className="text-white">{formatDate(selected.createdAt)}</p>
                    <p className="text-xs">
                      {PAYMENT_LABELS[selected.paymentMethod] ?? selected.paymentMethod}
                    </p>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Origen de confirmación</p>
                  {selected.confirmationSource ? (
                    <span
                      className={`inline-block text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-sm border ${CONFIRMATION_SOURCE_COLORS[selected.confirmationSource] ?? "bg-white/5 text-white/40 border-white/10"}`}
                    >
                      {CONFIRMATION_SOURCE_LABELS[selected.confirmationSource] ?? selected.confirmationSource}
                    </span>
                  ) : (
                    <span className="text-white/30 text-xs">Sin dato (orden anterior a esta función)</span>
                  )}
                </div>
                {selected.paymentMethod === "paypal" && (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Tipo de cambio aplicado</p>
                    {selected.arsToUsdRate ? (
                      <p className="text-white font-mono text-sm">
                        1 USD = ${parseFloat(selected.arsToUsdRate).toLocaleString("es-AR", { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ARS{" "}
                        <span className="text-white/40 text-xs">
                          (≈ USD {(selected.total / parseFloat(selected.arsToUsdRate)).toFixed(2)})
                        </span>
                      </p>
                    ) : (
                      <span className="text-white/30 text-xs">Sin dato (orden anterior a esta función)</span>
                    )}
                  </div>
                )}
                <div className="border-t border-white/5 pt-3">
                  <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2">
                    Diseños
                  </p>
                  <ul className="space-y-2">
                    {selected.items.map((it, i) => (
                      <li
                        key={`${it.productId}-${i}`}
                        className="flex justify-between text-white/80"
                      >
                        <span>
                          {it.name}{" "}
                          <span className="text-white/40">×{it.quantity}</span>
                        </span>
                        <span className="font-mono">
                          {formatARS(it.price * it.quantity)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="border-t border-white/5 pt-3 flex justify-between text-base font-black">
                  <span>TOTAL</span>
                  <span className="font-mono text-primary">
                    {formatARS(selected.total)}
                  </span>
                </div>
                <Button
                  onClick={() => printInvoice(selected)}
                  className="w-full bg-primary hover:bg-primary/90"
                >
                  <Printer className="h-4 w-4 mr-2" /> Imprimir / Guardar PDF
                </Button>
                {selected.status === "paid" && (
                  <Button
                    onClick={() => downloadInvoicePdf(selected.id)}
                    variant="outline"
                    className="w-full border-white/10 hover:bg-white/5"
                  >
                    <Download className="h-4 w-4 mr-2" /> Descargar comprobante PDF
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
