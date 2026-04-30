import { useState, useMemo } from "react";
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

const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

function downloadInvoicePdf(orderId: string): void {
  // Clerk session cookie is sent automatically (same origin); the server's
  // requireAdmin middleware will validate it. Browser will start the download.
  window.open(`${BASE}/api/orders/${orderId}/invoice-pdf`, "_blank");
}

type PaymentMethodFilter = "all" | "paypal" | "mercadopago" | "transferencia";

function downloadOrdersCsv(method: PaymentMethodFilter): void {
  // Clerk session cookie is sent automatically (same origin); the server's
  // requireAdmin middleware validates the user. The query string keeps the
  // server-side filter in sync with what the admin sees in the table.
  const qs = method === "all" ? "" : `?paymentMethod=${method}`;
  window.open(`${BASE}/api/orders/export${qs}`, "_blank");
}

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

export function InvoicesTab() {
  const { data: orders, isLoading } = useListOrders<Order[]>();
  const [search, setSearch] = useState("");
  const [methodFilter, setMethodFilter] = useState<PaymentMethodFilter>("all");
  const [selected, setSelected] = useState<Order | null>(null);

  const filtered = useMemo(() => {
    if (!orders) return [];
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (methodFilter !== "all" && o.paymentMethod !== methodFilter) {
        return false;
      }
      if (!q) return true;
      return (
        o.customerName.toLowerCase().includes(q) ||
        o.customerEmail.toLowerCase().includes(q) ||
        formatInvoiceNumber(o.invoiceNumber).includes(q) ||
        o.id.includes(q)
      );
    });
  }, [orders, search, methodFilter]);

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
        <div className="flex flex-col sm:flex-row gap-2 w-full lg:w-auto">
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
            onClick={() => downloadOrdersCsv(methodFilter)}
            className="border-white/10 hover:bg-white/5 whitespace-nowrap"
            title="Descargar CSV con las órdenes filtradas"
          >
            <FileSpreadsheet className="h-4 w-4 mr-2" /> Exportar CSV
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-24 border border-dashed border-white/10 rounded-sm">
          <FileText className="h-10 w-10 text-white/20 mx-auto mb-3" />
          <p className="text-white/50">
            {orders && orders.length > 0
              ? "No hay resultados para esa búsqueda."
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
