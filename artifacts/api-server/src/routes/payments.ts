import { Router, type IRouter } from "express";
import { MercadoPagoConfig, Preference, Payment } from "mercadopago";
import { db, ordersTable, productsTable } from "@workspace/db";
import type { OrderItem } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { sendOrderConfirmationEmail } from "../lib/email";
import { logger } from "../lib/logger";
import { z } from "zod";

const router: IRouter = Router();

const DOMAIN = (process.env["REPLIT_DOMAINS"] ?? "localhost:80").split(",")[0];
const MP_ACCESS_TOKEN = process.env["MERCADOPAGO_ACCESS_TOKEN"] ?? "";
const PAYPAL_CLIENT_ID = process.env["PAYPAL_CLIENT_ID"] ?? "";
const PAYPAL_CLIENT_SECRET = process.env["PAYPAL_CLIENT_SECRET"] ?? "";
const UALA_PAYMENT_LINK = process.env["UALA_PAYMENT_LINK"] ?? "";

// ARS→USD conversion rate for PayPal (PayPal requires USD).
// Set PAYPAL_ARS_USD_RATE env var to keep it up-to-date (e.g. 1200).
// If not set, the server rejects PayPal orders rather than using a stale fallback.
const _rawRate = process.env["PAYPAL_ARS_USD_RATE"];
const PAYPAL_ARS_USD_RATE: number | null = _rawRate ? Number(_rawRate) : null;

const mpClient = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });

// ---------------------------------------------------------------------------
// Shared: cart input schema (only productId + quantity from client)
// ---------------------------------------------------------------------------

const CartItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(50),
});

const CustomerInfoSchema = z.object({
  customerName: z.string().min(1),
  customerEmail: z.string().email(),
  items: z.array(CartItemSchema).min(1).max(50),
});

// Resolve cart items from DB, returning authoritative products with server-side prices.
// Rejects unknown productIds and unpublished products.
async function resolveCartItems(
  cartItems: z.infer<typeof CartItemSchema>[],
): Promise<{ orderItems: OrderItem[]; total: number } | { error: string }> {
  const ids = cartItems.map((c) => c.productId);
  const products = await db
    .select()
    .from(productsTable)
    .where(inArray(productsTable.id, ids));

  const productMap = new Map(products.map((p) => [p.id, p]));

  const orderItems: OrderItem[] = [];
  for (const cartItem of cartItems) {
    const product = productMap.get(cartItem.productId);
    if (!product) return { error: `Producto no encontrado: ${cartItem.productId}` };
    if (!product.isPublished) return { error: `Producto no disponible: ${product.name}` };
    orderItems.push({
      productId: product.id,
      name: product.name,
      price: product.price,
      quantity: cartItem.quantity,
      imagePath: product.imagePath,
      filePath: product.filePath ?? null,
    });
  }

  const total = orderItems.reduce((s, i) => s + i.price * i.quantity, 0);
  return { orderItems, total };
}

// ---------------------------------------------------------------------------
// Mercado Pago — create preference
// ---------------------------------------------------------------------------

router.post("/payments/mercadopago/preference", async (req, res): Promise<void> => {
  const parsed = CustomerInfoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { customerName, customerEmail, items: cartItems } = parsed.data;

  try {
    const resolved = await resolveCartItems(cartItems);
    if ("error" in resolved) {
      res.status(422).json({ error: resolved.error });
      return;
    }
    const { orderItems, total } = resolved;

    // Create a pending order first to store orderId in MP external_reference
    const [order] = await db
      .insert(ordersTable)
      .values({
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim().toLowerCase(),
        items: orderItems,
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
        items: orderItems.map((it) => ({
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

    // Verify the gateway-reported amount matches the stored order total (fraud protection)
    const paidAmount = paymentData.transaction_amount ?? 0;
    const expectedAmount = existing.total;
    if (Math.abs(paidAmount - expectedAmount) > 1) {
      logger.error(
        { orderId, paidAmount, expectedAmount },
        "MP webhook: amount mismatch — order NOT marked paid",
      );
      return;
    }

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


function paypalBase(): string {
  const isSandbox =
    PAYPAL_CLIENT_ID.startsWith("sb-") ||
    PAYPAL_CLIENT_ID.includes("sandbox") ||
    process.env["NODE_ENV"] !== "production";
  return isSandbox ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
}

async function getPaypalAccessToken(): Promise<string> {
  const creds = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64");
  const base = paypalBase();
  const resp = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const data = (await resp.json()) as { access_token: string };
  if (!data.access_token) {
    throw new Error(`PayPal auth failed: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

router.post("/payments/paypal/create-order", async (req, res): Promise<void> => {
  const parsed = CustomerInfoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { customerName, customerEmail, items: cartItems } = parsed.data;

  if (!PAYPAL_ARS_USD_RATE || PAYPAL_ARS_USD_RATE <= 0) {
    res.status(503).json({ error: "Tipo de cambio ARS/USD no configurado. Contacte al administrador." });
    return;
  }

  try {
    const resolved = await resolveCartItems(cartItems);
    if ("error" in resolved) {
      res.status(422).json({ error: resolved.error });
      return;
    }
    const { orderItems, total } = resolved;

    const [order] = await db
      .insert(ordersTable)
      .values({
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim().toLowerCase(),
        items: orderItems,
        total,
        paymentMethod: "paypal",
        status: "pending",
      })
      .returning();

    const token = await getPaypalAccessToken();
    const base = paypalBase();

    // Convert ARS to USD using the configured exchange rate (PAYPAL_ARS_USD_RATE env var).
    const usdAmount = (total / PAYPAL_ARS_USD_RATE).toFixed(2);

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
            description: `DTF LAB — ${orderItems.length} diseño${orderItems.length > 1 ? "s" : ""}`,
            amount: {
              currency_code: "USD",
              value: usdAmount,
            },
          },
        ],
      }),
    });

    const ppOrder = (await ppResp.json()) as { id?: string; name?: string; message?: string };

    if (!ppOrder.id) {
      logger.error({ ppOrder }, "PayPal order creation failed — no order ID returned");
      res.status(502).json({ error: "No se pudo crear la orden en PayPal. Intentá nuevamente." });
      return;
    }

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

    type CaptureUnit = {
      reference_id?: string;
      payments?: {
        captures?: Array<{ amount?: { value?: string; currency_code?: string } }>;
      };
    };
    type CaptureResult = {
      status: string;
      purchase_units?: CaptureUnit[];
    };
    const capture = (await captureResp.json()) as CaptureResult;

    if (capture.status !== "COMPLETED") {
      res.status(400).json({ error: `Pago no completado: ${capture.status}` });
      return;
    }

    // Verify the captured order's reference_id matches our DB order ID
    const capturedUnit = capture.purchase_units?.[0];
    const capturedRef = capturedUnit?.reference_id;
    if (capturedRef && capturedRef !== orderId) {
      req.log.warn({ orderId, capturedRef }, "PayPal reference_id mismatch on capture");
      res.status(400).json({ error: "El pago capturado no corresponde a esta orden" });
      return;
    }

    // Verify captured amount against stored order total (fraud protection)
    if (PAYPAL_ARS_USD_RATE) {
      const capturedUsd = parseFloat(capturedUnit?.payments?.captures?.[0]?.amount?.value ?? "0");
      const expectedUsd = dbOrder.total / PAYPAL_ARS_USD_RATE;
      // Allow 1 USD tolerance for rounding
      if (capturedUsd > 0 && Math.abs(capturedUsd - expectedUsd) > 1) {
        req.log.error({ orderId, capturedUsd, expectedUsd }, "PayPal amount mismatch — NOT marking paid");
        res.status(400).json({ error: "El monto capturado no coincide con el total de la orden" });
        return;
      }
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

router.post("/payments/uala/link", (_req, res): void => {
  if (!UALA_PAYMENT_LINK) {
    res.status(503).json({ error: "Link de Ualá no configurado" });
    return;
  }
  res.json({ url: UALA_PAYMENT_LINK });
});

export default router;
