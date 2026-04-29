import { Router, type IRouter } from "express";
import { eq, desc, sql, and, gte } from "drizzle-orm";
import { db, ordersTable } from "@workspace/db";
import type { OrderItem } from "@workspace/db";
import { CreateOrderBody, GetOrderParams } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireAdmin } from "../middlewares/requireAdmin";

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
  const { items, customerName, customerEmail, paymentMethod } = parsed.data;
  const total = items.reduce((sum, it) => sum + it.price * it.quantity, 0);

  try {
    const [row] = await db
      .insert(ordersTable)
      .values({
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim().toLowerCase(),
        items: items as OrderItem[],
        total,
        paymentMethod,
        status: "paid",
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
