import { Router, type IRouter } from "express";
import { MercadoPagoConfig, Preference, Payment } from "mercadopago";
import { db, ordersTable } from "@workspace/db";
import type { OrderItem } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sendOrderConfirmationEmail } from "../lib/email";
import { logger } from "../lib/logger";
import { z } from "zod";

const router: IRouter = Router();

const DOMAIN = (process.env["REPLIT_DOMAINS"] ?? "localhost:80").split(",")[0];
const MP_ACCESS_TOKEN = process.env["MERCADOPAGO_ACCESS_TOKEN"] ?? "";
const PAYPAL_CLIENT_ID = process.env["PAYPAL_CLIENT_ID"] ?? "";
const PAYPAL_CLIENT_SECRET = process.env["PAYPAL_CLIENT_SECRET"] ?? "";
const UALA_PAYMENT_LINK = process.env["UALA_PAYMENT_LINK"] ?? "";

const mpClient = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });

// ---------------------------------------------------------------------------
// Mercado Pago — create preference
// ---------------------------------------------------------------------------

const OrderItemSchema = z.object({
  productId: z.string(),
  name: z.string(),
  price: z.number().int().positive(),
  quantity: z.number().int().positive(),
  imagePath: z.string(),
  filePath: z.string().nullable().optional(),
});

const MpPreferenceBody = z.object({
  customerName: z.string().min(1),
  customerEmail: z.string().email(),
  items: z.array(OrderItemSchema).min(1),
});

router.post("/payments/mercadopago/preference", async (req, res): Promise<void> => {
  const parsed = MpPreferenceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { customerName, customerEmail, items } = parsed.data;
  type ParsedItem = (typeof parsed.data.items)[number];
  const total = items.reduce((s: number, i: ParsedItem) => s + i.price * i.quantity, 0);

  try {
    // Create a pending order first to store orderId in MP external_reference
    const [order] = await db
      .insert(ordersTable)
      .values({
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim().toLowerCase(),
        items: items as OrderItem[],
        total,
        paymentMethod: "mercadopago",
        status: "pending",
      })
      .returning();

    const preference = new Preference(mpClient);
    const pref = await preference.create({
      body: {
        external_reference: order.id,
        payer: { name: customerName, email: customerEmail },
        items: items.map((it: ParsedItem) => ({
          id: it.productId,
          title: it.name,
          quantity: it.quantity,
          unit_price: it.price,
          currency_id: "ARS",
        })),
        back_urls: {
          success: `https://${DOMAIN}/checkout/success`,
          pending: `https://${DOMAIN}/checkout/pending`,
          failure: `https://${DOMAIN}/checkout/failure`,
        },
        auto_return: "approved",
        notification_url: `https://${DOMAIN}/api/webhooks/mercadopago`,
      },
    });

    res.json({
      init_point: pref.init_point,
      sandbox_init_point: pref.sandbox_init_point,
      orderId: order.id,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create MP preference");
    res.status(500).json({ error: "No se pudo crear la preferencia de pago" });
  }
});

// ---------------------------------------------------------------------------
// Mercado Pago — webhook
// ---------------------------------------------------------------------------

router.post("/webhooks/mercadopago", async (req, res): Promise<void> => {
  res.sendStatus(200); // Acknowledge immediately

  const topic = req.query["topic"] ?? req.body?.type;
  const paymentId = req.query["id"] ?? req.body?.data?.id;

  if (topic !== "payment" && req.body?.type !== "payment") return;
  if (!paymentId) return;

  try {
    const payment = new Payment(mpClient);
    const paymentData = await payment.get({ id: String(paymentId) });

    if (paymentData.status !== "approved") return;

    const orderId = paymentData.external_reference;
    if (!orderId) return;

    const [existing] = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId));

    if (!existing || existing.status === "paid") return;

    const [updated] = await db
      .update(ordersTable)
      .set({ status: "paid", externalPaymentId: String(paymentId) })
      .where(eq(ordersTable.id, orderId))
      .returning();

    if (updated) {
      await sendOrderConfirmationEmail(updated);
    }
  } catch (err) {
    logger.error({ err }, "MP webhook processing error");
  }
});

// ---------------------------------------------------------------------------
// PayPal — create order
// ---------------------------------------------------------------------------

const PaypalOrderBody = z.object({
  customerName: z.string().min(1),
  customerEmail: z.string().email(),
  items: z.array(OrderItemSchema).min(1),
});

async function getPaypalAccessToken(): Promise<string> {
  const creds = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64");
  const base = PAYPAL_CLIENT_ID.startsWith("sb-") || PAYPAL_CLIENT_ID.includes("sandbox")
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com";
  const resp = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const data = (await resp.json()) as { access_token: string };
  return data.access_token;
}

function paypalBase(): string {
  return PAYPAL_CLIENT_ID.startsWith("sb-") || PAYPAL_CLIENT_ID.includes("sandbox") || process.env["NODE_ENV"] !== "production"
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com";
}

router.post("/payments/paypal/create-order", async (req, res): Promise<void> => {
  const parsed = PaypalOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { customerName, customerEmail, items } = parsed.data;
  type PPItem = (typeof parsed.data.items)[number];
  const total = items.reduce((s: number, i: PPItem) => s + i.price * i.quantity, 0);

  try {
    const [order] = await db
      .insert(ordersTable)
      .values({
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim().toLowerCase(),
        items: items as OrderItem[],
        total,
        paymentMethod: "paypal",
        status: "pending",
      })
      .returning();

    const token = await getPaypalAccessToken();
    const base = paypalBase();

    // Convert ARS to USD (approximate, PayPal requires USD for sandbox)
    const usdAmount = (total / 1200).toFixed(2);

    const ppResp = await fetch(`${base}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: order.id,
            description: `DTF LAB — ${items.length} diseño${items.length > 1 ? "s" : ""}`,
            amount: {
              currency_code: "USD",
              value: usdAmount,
            },
          },
        ],
      }),
    });

    const ppOrder = (await ppResp.json()) as { id: string };

    // Persist the PayPal order ID as externalPaymentId for traceability
    await db
      .update(ordersTable)
      .set({ externalPaymentId: ppOrder.id })
      .where(eq(ordersTable.id, order.id));

    res.json({ ppOrderId: ppOrder.id, orderId: order.id });
  } catch (err) {
    req.log.error({ err }, "Failed to create PayPal order");
    res.status(500).json({ error: "No se pudo crear el pedido en PayPal" });
  }
});

// ---------------------------------------------------------------------------
// PayPal — capture order
// ---------------------------------------------------------------------------

router.post("/payments/paypal/capture-order", async (req, res): Promise<void> => {
  const { ppOrderId, orderId } = req.body as { ppOrderId?: string; orderId?: string };
  if (!ppOrderId || !orderId) {
    res.status(400).json({ error: "ppOrderId y orderId son requeridos" });
    return;
  }

  try {
    // First verify the DB order exists and has the expected externalPaymentId (binding check)
    const [dbOrder] = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId));

    if (!dbOrder) {
      res.status(404).json({ error: "Pedido no encontrado" });
      return;
    }
    if (dbOrder.externalPaymentId !== ppOrderId) {
      req.log.warn({ orderId, ppOrderId, stored: dbOrder.externalPaymentId }, "PayPal order ID mismatch");
      res.status(400).json({ error: "El pedido de PayPal no corresponde a esta orden" });
      return;
    }
    if (dbOrder.status === "paid") {
      res.json(dbOrder);
      return;
    }

    const token = await getPaypalAccessToken();
    const base = paypalBase();

    const captureResp = await fetch(`${base}/v2/checkout/orders/${ppOrderId}/capture`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });

    type CaptureResult = {
      status: string;
      purchase_units?: Array<{ reference_id?: string }>;
    };
    const capture = (await captureResp.json()) as CaptureResult;

    if (capture.status !== "COMPLETED") {
      res.status(400).json({ error: `Pago no completado: ${capture.status}` });
      return;
    }

    // Verify the captured order's reference_id matches our DB order ID
    const capturedRef = capture.purchase_units?.[0]?.reference_id;
    if (capturedRef && capturedRef !== orderId) {
      req.log.warn({ orderId, capturedRef }, "PayPal reference_id mismatch on capture");
      res.status(400).json({ error: "El pago capturado no corresponde a esta orden" });
      return;
    }

    const [updated] = await db
      .update(ordersTable)
      .set({ status: "paid" })
      .where(eq(ordersTable.id, orderId))
      .returning();

    if (updated) {
      await sendOrderConfirmationEmail(updated);
    }

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to capture PayPal order");
    res.status(500).json({ error: "Error al capturar el pago de PayPal" });
  }
});

// ---------------------------------------------------------------------------
// Ualá Bis — return payment link
// ---------------------------------------------------------------------------

router.get("/payments/uala/link", (_req, res): void => {
  if (!UALA_PAYMENT_LINK) {
    res.status(503).json({ error: "Link de Ualá no configurado" });
    return;
  }
  res.json({ url: UALA_PAYMENT_LINK });
});

export default router;
