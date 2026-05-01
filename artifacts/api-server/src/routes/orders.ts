import { Router, type IRouter } from "express";
import { eq, desc, sql, and, gte, lte, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, ordersTable } from "@workspace/db";
import type { OrderItem } from "@workspace/db";
import { CreateOrderBody, GetOrderParams } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireAdmin } from "../middlewares/requireAdmin";
import { ordersByEmailRateLimiter } from "../middlewares/rateLimiters";
import { buildInvoicePdf } from "../lib/pdfInvoice";
import { isValidDniOrCuit } from "../lib/dniCuit";

const router: IRouter = Router();

// POST /orders is exclusively for admin manual order entry (requireAdmin checks
// that the user is both authenticated AND in the ADMIN_USER_IDS allowlist).
// Real customer orders go through /payments/* and are only marked "paid" after
// gateway confirmation — preventing any payment bypass.
router.post("/orders", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateOrderBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid order body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { items, customerName, customerEmail, customerDni, paymentMethod } = parsed.data;
  if (!isValidDniOrCuit(customerDni ?? null)) {
    res
      .status(400)
      .json({ error: "DNI/CUIT inválido (DNI 7-8 dígitos o CUIT 11 dígitos)" });
    return;
  }
  const total = items.reduce((sum, it) => sum + it.price * it.quantity, 0);

  // Manual entries are for offline sales the admin already fulfilled, so we
  // mark them as not requiring manual prep regardless of size selections.
  // The flag is computed defensively from the items in case the admin marked
  // any item with a non-original size or isCustomSize, since that would mean
  // the order isn't yet delivered. isPlanchaGrouped stays false because the
  // manual flow doesn't surface the grouping toggle.
  const typedItems = items as OrderItem[];
  const requiresManualPrep = typedItems.some(
    (it) =>
      it.isCustomSize === true ||
      (typeof it.selectedSize === "string" &&
        it.selectedSize.trim().length > 0 &&
        it.selectedSize !== "Original"),
  );

  try {
    const [row] = await db
      .insert(ordersTable)
      .values({
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim().toLowerCase(),
        customerDni: customerDni && customerDni.trim().length > 0 ? customerDni.trim() : null,
        items: typedItems,
        total,
        requiresManualPrep,
        paymentMethod,
        status: "paid",
        confirmationSource: "manual",
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to create order");
    res.status(400).json({ error: "No se pudo registrar la venta" });
  }
});

router.get("/orders", requireAuth, async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(ordersTable)
    .orderBy(desc(ordersTable.createdAt));
  res.json(rows);
});

// Admin-only: export orders as CSV for end-of-month auditing.
// Optional ?paymentMethod=paypal|mercadopago|transferencia filters
// server-side so the download matches what the admin sees in the panel
// after using the same quick-filter. Columns include the persisted
// ARS→USD rate and the USD equivalent for PayPal orders so admins can
// reconcile gateway statements without opening each order one by one.
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  mercadopago: "Mercado Pago",
  transferencia: "Transferencia bancaria",
  paypal: "PayPal",
};

function csvEscape(value: string): string {
  // Spreadsheet formula injection guard: cells starting with =, +, -, @
  // are interpreted as formulas by Excel/Sheets/LibreOffice. Prefix with a
  // single apostrophe so the cell renders as plain text. This must run
  // BEFORE the RFC-4180 quote logic so the apostrophe ends up inside the
  // quoted value rather than outside it.
  // Reference: OWASP — CSV Injection.
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) {
    v = `'${v}`;
  }
  // RFC 4180: wrap in quotes if contains comma, quote, newline; double inner quotes.
  if (/[",\n\r]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

// `from` / `to` accept ISO date (YYYY-MM-DD) or full ISO datetime so admins
// can either pick a calendar day in the panel or paste a precise timestamp
// for a tighter slice. Both are inclusive on the day boundary: `from` snaps
// to start-of-day UTC and `to` snaps to end-of-day UTC, matching the way
// accountants think about a "from / to" range in a quarterly report.
const isoDateOrDateTime = z
  .string()
  .refine(
    (s) => /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(s) && !Number.isNaN(Date.parse(s)),
    { message: "Fecha inválida (formato esperado YYYY-MM-DD)" },
  );

const ExportOrdersQuery = z
  .object({
    paymentMethod: z
      .enum(["mercadopago", "transferencia", "paypal"], {
        errorMap: () => ({ message: "paymentMethod inválido" }),
      })
      .optional(),
    from: isoDateOrDateTime.optional(),
    to: isoDateOrDateTime.optional(),
  })
  .refine(
    (q) => {
      if (!q.from || !q.to) return true;
      return Date.parse(q.from) <= Date.parse(q.to);
    },
    { message: "El rango de fechas es inválido (desde > hasta)", path: ["to"] },
  );

function parseFromBoundary(value: string): Date {
  // Date-only input: anchor to start-of-day UTC so the range is inclusive
  // of the chosen day regardless of the admin's local timezone.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00.000Z`);
  }
  return new Date(value);
}

function parseToBoundary(value: string): Date {
  // Date-only input: anchor to end-of-day UTC so a range like
  // 2026-01-01..2026-01-31 includes every order placed on Jan 31.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T23:59:59.999Z`);
  }
  return new Date(value);
}

router.get("/orders/export", requireAdmin, async (req, res): Promise<void> => {
  const parsed = ExportOrdersQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Parámetros inválidos" });
    return;
  }
  const { paymentMethod, from, to } = parsed.data;

  const conditions: SQL[] = [];
  if (paymentMethod) {
    conditions.push(eq(ordersTable.paymentMethod, paymentMethod));
  }
  if (from) {
    conditions.push(gte(ordersTable.createdAt, parseFromBoundary(from)));
  }
  if (to) {
    conditions.push(lte(ordersTable.createdAt, parseToBoundary(to)));
  }

  const rows = conditions.length > 0
    ? await db
        .select()
        .from(ordersTable)
        .where(conditions.length === 1 ? conditions[0]! : and(...conditions))
        .orderBy(desc(ordersTable.createdAt))
    : await db.select().from(ordersTable).orderBy(desc(ordersTable.createdAt));

  // Columns match the task spec exactly: N° factura, Fecha, Cliente, Total
  // ARS, Método, Tipo de cambio aplicado, USD equivalente. The customer
  // email is folded into the "Cliente" cell so admins can still match
  // gateway statements by email without an extra column.
  const header = [
    "N° factura",
    "Fecha",
    "Cliente",
    "Total ARS",
    "Método",
    "Tipo de cambio aplicado",
    "USD equivalente",
  ];

  const lines: string[] = [header.map(csvEscape).join(",")];
  for (const o of rows) {
    const invoiceStr = String(o.invoiceNumber).padStart(6, "0");
    const fecha = o.createdAt.toISOString();
    const cliente = `${o.customerName} <${o.customerEmail}>`;
    const methodLabel = PAYMENT_METHOD_LABELS[o.paymentMethod] ?? o.paymentMethod;
    let rateStr = "";
    let usdStr = "";
    if (o.paymentMethod === "paypal" && o.arsToUsdRate) {
      const rateNum = parseFloat(o.arsToUsdRate);
      if (Number.isFinite(rateNum) && rateNum > 0) {
        rateStr = rateNum.toFixed(4);
        usdStr = (o.total / rateNum).toFixed(2);
      }
    }
    lines.push(
      [
        invoiceStr,
        fecha,
        cliente,
        String(o.total),
        methodLabel,
        rateStr,
        usdStr,
      ]
        .map(csvEscape)
        .join(","),
    );
  }

  // BOM so Excel auto-detects UTF-8 (admins open these in Excel for audits).
  const body = "\uFEFF" + lines.join("\r\n") + "\r\n";

  // Filename encodes the active filters so an admin downloading several
  // ranges side by side can tell them apart without renaming files.
  // Examples:
  //   ordenes-2026-04-30.csv                       (no filter — today's snapshot)
  //   ordenes-paypal-2026-01-01_2026-01-31.csv     (method + range)
  //   ordenes-2026-01-01_2026-01-31.csv            (range only)
  const methodSuffix = paymentMethod ? `-${paymentMethod}` : "";
  let dateSuffix: string;
  if (from || to) {
    const fromLabel = from ? from.slice(0, 10) : "inicio";
    const toLabel = to ? to.slice(0, 10) : "hoy";
    dateSuffix = `${fromLabel}_${toLabel}`;
  } else {
    dateSuffix = new Date().toISOString().slice(0, 10);
  }
  const filename = `ordenes${methodSuffix}-${dateSuffix}.csv`;

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(body);
});

router.get("/orders/stats", requireAuth, async (_req, res): Promise<void> => {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - 6);
  startOfWeek.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(now);
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const startOfChart = new Date(now);
  startOfChart.setDate(now.getDate() - 29);
  startOfChart.setHours(0, 0, 0, 0);

  const paid = and(eq(ordersTable.status, "paid"));

  const [totals] = await db
    .select({
      totalRevenue: sql<number>`coalesce(sum(${ordersTable.total}),0)::int`,
      totalOrders: sql<number>`count(*)::int`,
    })
    .from(ordersTable)
    .where(paid);

  const [today] = await db
    .select({
      revenueToday: sql<number>`coalesce(sum(${ordersTable.total}),0)::int`,
      ordersToday: sql<number>`count(*)::int`,
    })
    .from(ordersTable)
    .where(and(paid, gte(ordersTable.createdAt, startOfDay)));

  const [week] = await db
    .select({
      revenueThisWeek: sql<number>`coalesce(sum(${ordersTable.total}),0)::int`,
    })
    .from(ordersTable)
    .where(and(paid, gte(ordersTable.createdAt, startOfWeek)));

  const [month] = await db
    .select({
      revenueThisMonth: sql<number>`coalesce(sum(${ordersTable.total}),0)::int`,
    })
    .from(ordersTable)
    .where(and(paid, gte(ordersTable.createdAt, startOfMonth)));

  const byDayRows = await db
    .select({
      date: sql<string>`to_char(date_trunc('day', ${ordersTable.createdAt}), 'YYYY-MM-DD')`,
      revenue: sql<number>`coalesce(sum(${ordersTable.total}),0)::int`,
      orders: sql<number>`count(*)::int`,
    })
    .from(ordersTable)
    .where(and(paid, gte(ordersTable.createdAt, startOfChart)))
    .groupBy(sql`date_trunc('day', ${ordersTable.createdAt})`)
    .orderBy(sql`date_trunc('day', ${ordersTable.createdAt}) asc`);

  const byDayMap = new Map(byDayRows.map((r) => [r.date, r]));
  const revenueByDay: Array<{ date: string; revenue: number; orders: number }> = [];
  for (let i = 0; i < 30; i += 1) {
    const d = new Date(startOfChart);
    d.setDate(startOfChart.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    const found = byDayMap.get(key);
    revenueByDay.push({
      date: key,
      revenue: found?.revenue ?? 0,
      orders: found?.orders ?? 0,
    });
  }

  const topProducts = await db
    .select({
      productId: sql<string>`item->>'productId'`,
      name: sql<string>`item->>'name'`,
      quantity: sql<number>`sum((item->>'quantity')::int)::int`,
      revenue: sql<number>`sum((item->>'price')::int * (item->>'quantity')::int)::int`,
    })
    .from(
      sql`${ordersTable}, jsonb_array_elements(${ordersTable.items}) as item`,
    )
    .where(paid)
    .groupBy(sql`item->>'productId', item->>'name'`)
    .orderBy(sql`sum((item->>'price')::int * (item->>'quantity')::int) desc`)
    .limit(5);

  const byMethod = await db
    .select({
      method: ordersTable.paymentMethod,
      revenue: sql<number>`coalesce(sum(${ordersTable.total}),0)::int`,
      orders: sql<number>`count(*)::int`,
    })
    .from(ordersTable)
    .where(paid)
    .groupBy(ordersTable.paymentMethod);

  res.json({
    totalRevenue: totals?.totalRevenue ?? 0,
    totalOrders: totals?.totalOrders ?? 0,
    revenueToday: today?.revenueToday ?? 0,
    ordersToday: today?.ordersToday ?? 0,
    revenueThisWeek: week?.revenueThisWeek ?? 0,
    revenueThisMonth: month?.revenueThisMonth ?? 0,
    revenueByDay,
    topProducts,
    revenueByMethod: byMethod,
  });
});

// Public endpoint: returns paid orders for a given buyer email so they can
// re-download their files without needing the original confirmation email.
// Only exposes non-sensitive order data (no internal IDs beyond invoiceNumber).
// IMPORTANT: must be registered before GET /orders/:id to avoid route shadowing.
router.get("/orders/by-email", ordersByEmailRateLimiter, async (req, res): Promise<void> => {
  const parsed = z.object({ email: z.string().email() }).safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Email inválido" });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const rows = await db
    .select({
      invoiceNumber: ordersTable.invoiceNumber,
      customerName: ordersTable.customerName,
      items: ordersTable.items,
      total: ordersTable.total,
      paymentMethod: ordersTable.paymentMethod,
      createdAt: ordersTable.createdAt,
      // Required by MisCompras to gate the "Descargar" button — when true,
      // the order is in manual preparation (custom/non-original size or
      // armar-plancha) and the buyer must wait 24hs hábiles instead of
      // getting an immediate download.
      requiresManualPrep: ordersTable.requiresManualPrep,
    })
    .from(ordersTable)
    .where(and(eq(ordersTable.customerEmail, email), eq(ordersTable.status, "paid")))
    .orderBy(desc(ordersTable.createdAt));
  res.json(rows);
});

router.get("/orders/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Pedido no encontrado" });
    return;
  }
  res.json(row);
});

// Admin-only: download a PDF receipt for a paid order.
// Returns 404 if the order is not paid (no receipt for pending/failed orders).
router.get("/orders/:id/invoice-pdf", requireAdmin, async (req, res): Promise<void> => {
  const params = GetOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Pedido no encontrado" });
    return;
  }
  if (row.status !== "paid") {
    res.status(404).json({ error: "El comprobante sólo está disponible para pedidos pagados" });
    return;
  }

  try {
    const buf = await buildInvoicePdf(row);
    const invoiceStr = String(row.invoiceNumber).padStart(6, "0");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="comprobante-N${invoiceStr}.pdf"`,
    );
    res.setHeader("Content-Length", String(buf.length));
    res.end(buf);
  } catch (err) {
    req.log.error({ err, orderId: row.id }, "Failed to generate invoice PDF");
    res.status(500).json({ error: "No se pudo generar el comprobante" });
  }
});

// Public endpoint: returns only invoiceNumber for a confirmed order.
// Safe to expose — orderId is a UUID from MP external_reference, no sensitive data returned.
router.get("/orders/:id/invoice", async (req, res): Promise<void> => {
  const params = GetOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const [row] = await db
    .select({ invoiceNumber: ordersTable.invoiceNumber, status: ordersTable.status })
    .from(ordersTable)
    .where(eq(ordersTable.id, params.data.id));
  if (!row || row.status !== "paid") {
    res.status(404).json({ error: "Pedido no encontrado o pendiente" });
    return;
  }
  res.json({ invoiceNumber: row.invoiceNumber });
});

export default router;
